# Edge Case Fixes for Chimera Local AI Stack

## Summary
Fixed critical edge cases and error handling issues in the Chimera RAG pipeline to improve resilience, stability, and error recovery in the local AI stack.

---

## MCP Server (`mcp-chimera-rag/index.js`)

### 🔧 Changes Made

#### 1. **Retry Logic with Exponential Backoff**
- **Problem**: Network failures caused immediate tool failures with no recovery
- **Solution**:
  - Added `fetchWithRetry()` that retries failed requests up to 3 times
  - Exponential backoff: 500ms → 1s → 2s (with jitter to prevent thundering herd)
  - Configurable via `MAX_RETRIES` and `REQUEST_TIMEOUT` env vars

#### 2. **Request Timeout Handling**
- **Problem**: Requests could hang indefinitely if RAG server was slow/unresponsive
- **Solution**:
  - Added `fetchWithTimeout()` with 30s default timeout (configurable)
  - Uses `AbortController` to cancel long-running requests
  - Timeout can be tuned via `REQUEST_TIMEOUT` env var

#### 3. **HTTP Connection Pooling**
- **Problem**: Each request created a new connection, wasting resources
- **Solution**:
  - Added HTTP/HTTPS agents with keep-alive enabled
  - Max 10 concurrent sockets per agent
  - Reduces connection overhead for high-frequency calls

#### 4. **Response Validation**
- **Problem**: No validation that responses were valid JSON
- **Solution**:
  - Check HTTP status codes (retry on 5xx, fail on 4xx)
  - Validate `Content-Type` header is `application/json`
  - Prevents parsing errors on error pages

#### 5. **Input Validation & Sanitization**
- **Problem**: No validation of tool arguments from LM Studio
- **Solution**:
  - Type checking for all inputs (string, number validation)
  - Non-empty string validation for queries
  - Clamped numeric ranges:
    - `limit`: 1-100 (prevent memory exhaustion)
    - `threshold`: 0-1 (valid similarity scores)
  - File size limit: 50MB (prevent OOM on large uploads)
  - URL encoding for document IDs

#### 6. **RAG Server Health Validation at Startup**
- **Problem**: MCP server would start even if RAG server was unavailable
- **Solution**:
  - Validate RAG server responds to `/health` before starting MCP
  - Warning logged if unavailable but server still starts (graceful degradation)
  - Tools will fail with clear error messages if RAG becomes unreachable

#### 7. **Better Error Messages**
- **Problem**: Generic errors made debugging difficult
- **Solution**:
  - Distinguish between client errors (invalid input) and server errors (unavailable services)
  - Include operation context in error messages
  - Timeout errors clearly indicate what failed

---

## RAG Server (`rag-setup/app.py`)

### 🔧 Changes Made

#### 1. **Improved Health Checks**
- **Problem**: Health endpoint didn't actually test service connectivity
- **Solution**:
  - Test embeddings service with actual embed call
  - Test search service with connectivity check
  - Test LM Studio with actual health endpoint
  - Return "degraded" status if critical services (DB, embeddings) fail
  - Non-critical services (search, LLM) can be down without failing health check

#### 2. **File Upload Validation**
- **Problem**: No size limits, could cause OOM; no file type validation
- **Solution**:
  - 50MB file size limit (configurable)
  - File type whitelist: `.pdf`, `.txt`, `.md`, `.docx`
  - Empty file rejection
  - Graceful error messages for oversized files (HTTP 413)

#### 3. **Document Processing Error Handling**
- **Problem**: Failed extraction/embedding could lose files
- **Solution**:
  - Validate text extraction succeeded before continuing
  - Validate chunks are created
  - Graceful failure if embedding fails mid-batch
  - Report chunk count and detailed error messages
  - File stored before processing (can recover later if needed)

#### 4. **Search Request Validation**
- **Problem**: Could submit huge queries; no bounds checking
- **Solution**:
  - Empty query rejection
  - Max 1000 character queries
  - Clamp `limit` to 1-50 (prevent huge responses)
  - Clamp `threshold` to 0-1 (valid cosine similarity range)
  - Clear error for invalid search types

#### 5. **Service Availability Checks**
- **Problem**: Operations would fail cryptically if a service was down
- **Solution**:
  - Check services are initialized before operations
  - Different errors for missing vs. failed services
  - Propagate detailed error messages from service failures

---

## Docker Composition

### Issues Identified (Not Yet Fixed)

These edge cases exist in the Docker setup but require infrastructure changes:

1. **Startup Race Conditions**
   - Issue: RAG server might start before postgres is ready
   - Mitigation: Already in place via healthcheck dependencies in docker-compose.yml

2. **Network Timeouts**
   - Issue: Service-to-service calls could timeout
   - Recommended: Add network timeouts in embeddings/search service configs

3. **Disk Space**
   - Issue: Vector DB could fill disk
   - Recommended: Add volume size limits in docker-compose

4. **Container Restarts**
   - Issue: No restart policy if container crashes
   - Recommended: Add `restart: on-failure` policy

---

## Environment Variables

### New/Updated Configuration

```bash
# MCP Timeouts and Retries
REQUEST_TIMEOUT=30000        # 30 seconds (can reduce for fast networks)
MAX_RETRIES=3               # Number of retry attempts
INITIAL_BACKOFF=500         # Starting backoff in ms

# File Upload Limits
MAX_FILE_SIZE=52428800      # 50MB (in app.py)

# Service URLs (existing, but now validated at startup)
RAG_SERVER_URL=http://localhost:8080
```

---

## Testing Edge Cases

### Test Commands

```bash
# Test timeout handling (will fail and retry)
curl -X POST http://localhost:8080/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "", "limit": 5}'

# Test file size limit
dd if=/dev/zero bs=1M count=100 | curl -X POST \
  -F "file=@-" http://localhost:8080/api/documents/upload

# Test invalid input
curl -X POST http://localhost:8080/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "limit": 999}'

# Check health including service connectivity
curl http://localhost:8080/health
```

---

## Deployment Recommendations

1. **Monitor**: Watch logs for retry messages or timeout warnings
2. **Set timeouts**: Adjust `REQUEST_TIMEOUT` based on your hardware performance
3. **Rate limiting**: Consider adding rate limiting to prevent abuse (TODO)
4. **Logging**: Enable `LOG_LEVEL=DEBUG` in production monitoring
5. **Circuit breaker**: Consider adding circuit breaker pattern for downstream services (advanced)

---

## Future Improvements

- [ ] Circuit breaker pattern for downstream services
- [ ] Request rate limiting
- [ ] Metrics/monitoring integration
- [ ] Streaming response handling for large result sets
- [ ] Graceful service degradation (e.g., no web search but docs work)
- [ ] Request deduplication to prevent duplicate work
- [ ] Caching layer for common queries

