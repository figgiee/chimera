"""
Synapse - AI development framework for local AI stacks.
Designed for token-efficient operation with small models (9B-70B).

Core flow: discuss → plan → execute → checkpoint
State lives in PostgreSQL, context assembled per-turn via RAG.
"""

import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mode definitions
# ---------------------------------------------------------------------------

MODES = {
    "feature": {
        "id": "feature",
        "name": "Feature Addition",
        "description": "Add new functionality to the codebase",
        "discussion_areas": [
            {
                "id": "scope",
                "label": "Scope",
                "question": "What exactly should this feature do? What are the boundaries?",
                "required": True,
            },
            {
                "id": "interface",
                "label": "Interface",
                "question": "How will users interact with this feature? What's the API surface?",
                "required": True,
            },
            {
                "id": "dependencies",
                "label": "Dependencies",
                "question": "Does this require new libraries or external services?",
                "required": False,
            },
            {
                "id": "testing",
                "label": "Testing",
                "question": "What test coverage is needed? Any edge cases to consider?",
                "required": False,
            },
        ],
        "escalation_signals": [
            {"id": "ambiguous-scope", "description": "Feature scope is unclear or unbounded", "blocking": True},
            {"id": "api-surface-change", "description": "Changes public API contracts", "blocking": True},
            {"id": "dependency-needed", "description": "Requires unvetted external dependency", "blocking": False},
            {"id": "destructive-operation", "description": "Could delete or corrupt data", "blocking": True},
        ],
        "verification_criteria": [
            "Feature works as specified in scope",
            "Tests pass with adequate coverage",
            "No regressions in existing functionality",
            "API is documented if public",
        ],
    },
    "refactor": {
        "id": "refactor",
        "name": "Code Refactor",
        "description": "Restructure existing code without changing behavior",
        "discussion_areas": [
            {
                "id": "scope",
                "label": "Scope",
                "question": "What code needs restructuring? What's the target architecture?",
                "required": True,
            },
            {
                "id": "api-preservation",
                "label": "API Preservation",
                "question": "Which public interfaces must remain unchanged?",
                "required": True,
            },
            {
                "id": "testing",
                "label": "Testing",
                "question": "How will you verify behavior is unchanged after refactoring?",
                "required": False,
            },
        ],
        "escalation_signals": [
            {"id": "ambiguous-scope", "description": "Refactor boundaries unclear", "blocking": True},
            {"id": "public-api-break", "description": "Would break existing callers", "blocking": True},
            {"id": "destructive-operation", "description": "Could lose data or state", "blocking": True},
        ],
        "verification_criteria": [
            "All existing tests still pass",
            "Public API unchanged",
            "Code meets target architecture",
            "No behavior changes detected",
        ],
    },
    "bugfix": {
        "id": "bugfix",
        "name": "Bug Fix",
        "description": "Diagnose and fix a specific bug",
        "discussion_areas": [
            {
                "id": "reproduction",
                "label": "Reproduction",
                "question": "How do you reproduce this bug? What's the expected vs actual behavior?",
                "required": True,
            },
            {
                "id": "scope",
                "label": "Scope",
                "question": "Is this a single bug or a symptom of a larger issue?",
                "required": True,
            },
            {
                "id": "root-cause",
                "label": "Root Cause",
                "question": "Do you have any idea what's causing it? Where in the code?",
                "required": False,
            },
        ],
        "escalation_signals": [
            {"id": "ambiguous-scope", "description": "Bug is not clearly reproducible", "blocking": True},
            {"id": "data-mutation-risk", "description": "Fix touches data mutation paths", "blocking": False},
            {"id": "destructive-operation", "description": "Fix could introduce data loss", "blocking": True},
        ],
        "verification_criteria": [
            "Bug no longer reproducible",
            "Regression test added",
            "No side effects introduced",
            "Root cause documented",
        ],
    },
    "research": {
        "id": "research",
        "name": "Research & Investigation",
        "description": "Explore a technical question or evaluate options",
        "discussion_areas": [
            {
                "id": "question",
                "label": "Research Question",
                "question": "What specific question are you trying to answer?",
                "required": True,
            },
            {
                "id": "constraints",
                "label": "Constraints",
                "question": "What constraints apply? (performance, compatibility, cost, etc.)",
                "required": False,
            },
            {
                "id": "deliverable",
                "label": "Deliverable",
                "question": "What form should the answer take? (comparison doc, prototype, recommendation?)",
                "required": False,
            },
        ],
        "escalation_signals": [
            {"id": "ambiguous-scope", "description": "Research question too broad", "blocking": True},
        ],
        "verification_criteria": [
            "Research question answered with evidence",
            "Constraints addressed",
            "Deliverable produced in requested format",
        ],
    },
    "debug": {
        "id": "debug",
        "name": "Debug Session",
        "description": "Systematic debugging with hypothesis tracking",
        "discussion_areas": [
            {
                "id": "symptoms",
                "label": "Symptoms",
                "question": "What's going wrong? Error messages, unexpected behavior, logs?",
                "required": True,
            },
            {
                "id": "environment",
                "label": "Environment",
                "question": "Where does this happen? (OS, runtime, versions, config?)",
                "required": True,
            },
            {
                "id": "changes",
                "label": "Recent Changes",
                "question": "What changed recently before this started? Deployments, updates, config changes?",
                "required": False,
            },
        ],
        "escalation_signals": [
            {"id": "ambiguous-scope", "description": "Symptoms not reproducible", "blocking": True},
            {"id": "data-mutation-risk", "description": "Debug requires modifying production data", "blocking": True},
        ],
        "verification_criteria": [
            "Root cause identified",
            "Fix verified or workaround documented",
            "Steps to reproduce documented for future reference",
        ],
    },
}


# ---------------------------------------------------------------------------
# Discussion engine
# ---------------------------------------------------------------------------

class DiscussionEngine:
    """Manages the discussion phase — resolves gray areas before execution."""

    def __init__(self, embeddings_service=None):
        self.embeddings_service = embeddings_service

    async def get_next_question(self, session_data: dict) -> Optional[dict]:
        """Determine the next question to ask based on session state.

        Returns None if all required areas are resolved.
        """
        mode = MODES.get(session_data["mode"])
        if not mode:
            return None

        decisions = json.loads(session_data.get("decisions", "{}"))
        areas = mode["discussion_areas"]

        for area in areas:
            if area["id"] in decisions:
                continue  # already answered

            if area["required"]:
                return {
                    "area_id": area["id"],
                    "label": area["label"],
                    "question": area["question"],
                    "required": True,
                }

            # For optional areas, check semantic relevance
            if self.embeddings_service and session_data.get("user_request"):
                is_relevant = await self._check_relevance(
                    area, session_data["user_request"]
                )
                if is_relevant:
                    return {
                        "area_id": area["id"],
                        "label": area["label"],
                        "question": area["question"],
                        "required": False,
                    }

        return None  # all areas resolved

    async def process_answer(
        self, session_data: dict, area_id: str, answer: str
    ) -> dict:
        """Process an answer and check for delegation phrases."""
        decisions = json.loads(session_data.get("decisions", "{}"))

        # Detect delegation ("you decide", "your call", "up to you", etc.)
        delegation_phrases = [
            "you decide", "your call", "up to you", "whatever you think",
            "your choice", "auto", "default", "skip", "dont care", "don't care",
        ]
        delegated = any(p in answer.lower() for p in delegation_phrases)

        decisions[area_id] = {
            "answer": answer,
            "delegated": delegated,
            "timestamp": datetime.utcnow().isoformat(),
        }

        return decisions

    async def _check_relevance(self, area: dict, user_request: str) -> bool:
        """Check if an optional area is relevant using embedding similarity."""
        if not self.embeddings_service:
            return False
        try:
            area_text = f"{area['label']}: {area['question']}"
            area_emb = await self.embeddings_service.embed(area_text)
            request_emb = await self.embeddings_service.embed(user_request)

            # Cosine similarity (vectors are already normalized by TEI)
            similarity = sum(a * b for a, b in zip(area_emb, request_emb))
            return similarity > 0.45
        except Exception as e:
            logger.warning(f"Relevance check failed: {e}")
            return False  # skip optional area on error


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class Planner:
    """Generates wave-based execution plans from discussion decisions."""

    def check_escalation(self, mode_id: str, decisions: dict, user_request: str) -> Optional[dict]:
        """Check if any escalation signals fire. Returns the blocking signal or None."""
        mode = MODES.get(mode_id)
        if not mode:
            return None

        for signal in mode.get("escalation_signals", []):
            if self._signal_fires(signal, decisions, user_request):
                if signal.get("blocking", False):
                    return {
                        "signal_id": signal["id"],
                        "description": signal["description"],
                        "blocking": True,
                    }
        return None

    def generate_plan(self, mode_id: str, decisions: dict, user_request: str) -> List[dict]:
        """Generate a wave-based plan from mode + decisions.

        Returns list of waves, each containing tasks.
        Tasks are actionable steps derived from the user request + decisions,
        with verification criteria as the final validation wave.
        """
        mode = MODES.get(mode_id)
        if not mode:
            return []

        tasks = []

        # --- Wave 1+: Actionable tasks derived from decisions ---
        if mode_id == "feature":
            scope = decisions.get("scope", {}).get("answer", user_request)[:200]
            interface = decisions.get("interface", {}).get("answer", "")[:200]
            tasks.append({"id": "task-1", "description": f"Implement core logic: {scope}", "status": "pending", "notes": ""})
            if interface:
                tasks.append({"id": "task-2", "description": f"Wire up interface: {interface}", "status": "pending", "notes": ""})
            tasks.append({"id": "task-3", "description": "Write tests for the new feature", "status": "pending", "notes": ""})
            if decisions.get("dependencies") and not decisions["dependencies"].get("delegated"):
                tasks.append({"id": "task-deps", "description": f"Install dependencies: {decisions['dependencies']['answer'][:150]}", "status": "pending", "notes": ""})

        elif mode_id == "bugfix":
            repro = decisions.get("reproduction", {}).get("answer", "")[:200]
            scope = decisions.get("scope", {}).get("answer", "")[:200]
            root = decisions.get("root-cause", {}).get("answer", "")[:200]
            tasks.append({"id": "task-1", "description": f"Reproduce the bug: {repro or user_request[:150]}", "status": "pending", "notes": ""})
            if root:
                tasks.append({"id": "task-2", "description": f"Fix root cause: {root}", "status": "pending", "notes": ""})
            else:
                tasks.append({"id": "task-2", "description": f"Identify and fix root cause ({scope or user_request[:100]})", "status": "pending", "notes": ""})
            tasks.append({"id": "task-3", "description": "Add regression test to prevent recurrence", "status": "pending", "notes": ""})

        elif mode_id == "refactor":
            scope = decisions.get("scope", {}).get("answer", user_request)[:200]
            api_pres = decisions.get("api-preservation", {}).get("answer", "")[:150]
            tasks.append({"id": "task-1", "description": f"Restructure: {scope}", "status": "pending", "notes": ""})
            if api_pres:
                tasks.append({"id": "task-2", "description": f"Verify API unchanged: {api_pres}", "status": "pending", "notes": ""})
            tasks.append({"id": "task-3", "description": "Run existing tests to confirm no behavior change", "status": "pending", "notes": ""})

        elif mode_id == "research":
            question = decisions.get("question", {}).get("answer", user_request)[:200]
            deliverable = decisions.get("deliverable", {}).get("answer", "summary document")[:150]
            constraints = decisions.get("constraints", {}).get("answer", "")[:150]
            tasks.append({"id": "task-1", "description": f"Research: {question}", "status": "pending", "notes": ""})
            if constraints:
                tasks.append({"id": "task-2", "description": f"Evaluate against constraints: {constraints}", "status": "pending", "notes": ""})
            tasks.append({"id": "task-3", "description": f"Produce deliverable: {deliverable}", "status": "pending", "notes": ""})

        elif mode_id == "debug":
            symptoms = decisions.get("symptoms", {}).get("answer", user_request)[:200]
            env = decisions.get("environment", {}).get("answer", "")[:150]
            tasks.append({"id": "task-1", "description": f"Investigate symptoms: {symptoms}", "status": "pending", "notes": ""})
            if env:
                tasks.append({"id": "task-2", "description": f"Check environment: {env}", "status": "pending", "notes": ""})
            tasks.append({"id": "task-3", "description": "Isolate root cause and document findings", "status": "pending", "notes": ""})
            tasks.append({"id": "task-4", "description": "Document steps to reproduce for future reference", "status": "pending", "notes": ""})

        else:
            # Fallback — generic tasks from verification criteria
            for i, criterion in enumerate(mode.get("verification_criteria", [])):
                tasks.append({"id": f"task-{i+1}", "description": criterion, "status": "pending", "notes": ""})

        # --- Final wave: Verification checklist ---
        criteria = mode.get("verification_criteria", [])
        for i, criterion in enumerate(criteria):
            tasks.append({
                "id": f"verify-{i+1}",
                "description": f"[verify] {criterion}",
                "status": "pending",
                "notes": "",
            })

        # Group into waves (max 3 tasks per wave for small model focus)
        waves = []
        for i in range(0, len(tasks), 3):
            waves.append({
                "wave": len(waves) + 1,
                "tasks": tasks[i:i+3],
            })

        return waves

    def _signal_fires(self, signal: dict, decisions: dict, user_request: str) -> bool:
        """Evaluate whether an escalation signal fires."""
        import re as _re
        sid = signal["id"]

        if sid == "ambiguous-scope":
            # Check the primary scope-like field for each mode:
            # feature/refactor → scope, bugfix → reproduction or scope,
            # research → question, debug → symptoms
            scope_decision = (
                decisions.get("scope")
                or decisions.get("question")
                or decisions.get("reproduction")
                or decisions.get("symptoms")
            )
            if not scope_decision:
                return True
            answer = scope_decision.get("answer", "")
            return len(answer.strip()) < 10  # too vague

        if sid == "destructive-operation":
            destructive_keywords = [
                "delete", "drop", "destroy", "truncate", "wipe",
                "purge", "overwrite",
            ]
            # Build word-boundary pattern to avoid matching "strip HTML" or
            # "remove whitespace" — only match standalone destructive verbs
            pattern = r'\b(' + '|'.join(destructive_keywords) + r')\b'
            all_text = user_request.lower()
            for d in decisions.values():
                all_text += " " + d.get("answer", "").lower()
            return bool(_re.search(pattern, all_text))

        if sid in ("api-surface-change", "public-api-break"):
            api_decision = decisions.get("interface") or decisions.get("api-preservation")
            if api_decision and not api_decision.get("delegated"):
                answer = api_decision.get("answer", "").lower()
                # Use word-boundary matching to avoid "unchanged" matching "change"
                api_keywords = ["change", "break", "modify", "new endpoint", "remove"]
                pattern = r'\b(' + '|'.join(api_keywords) + r')\b'
                return bool(_re.search(pattern, answer))
            return False

        if sid == "data-mutation-risk":
            all_text = user_request.lower()
            for d in decisions.values():
                all_text += " " + d.get("answer", "").lower()
            return any(kw in all_text for kw in ["database", "migration", "update record", "modify data"])

        if sid == "dependency-needed":
            dep_decision = decisions.get("dependencies")
            if dep_decision and not dep_decision.get("delegated"):
                answer = dep_decision.get("answer", "").lower()
                return any(w in answer for w in ["install", "add", "require", "npm", "pip", "package"])
            return False

        return False


# ---------------------------------------------------------------------------
# Context assembler — the token-budget enforcer
# ---------------------------------------------------------------------------

class ContextAssembler:
    """Assembles minimal context for the current task within a token budget."""

    MAX_CONTEXT_TOKENS = 1500  # ~6000 chars, leaves room for model response

    def build_task_context(self, session_data: dict) -> dict:
        """Build compact context for the current task.

        Returns a dict the MCP server sends to LM Studio, NOT the full session.
        """
        mode = MODES.get(session_data["mode"], {})
        plan = json.loads(session_data.get("plan", "[]"))
        decisions = json.loads(session_data.get("decisions", "{}"))
        completed = json.loads(session_data.get("completed_tasks", "[]"))
        current_wave = session_data.get("current_wave", 0)
        current_task_idx = session_data.get("current_task", 0)

        # Get current task
        current_task = None
        if plan and current_wave < len(plan):
            wave = plan[current_wave]
            tasks = wave.get("tasks", [])
            if current_task_idx < len(tasks):
                current_task = tasks[current_task_idx]

        if not current_task:
            return {
                "status": "no_task",
                "message": "All tasks completed or no plan generated",
            }

        # Build compact context
        context = {
            "mode": mode.get("name", session_data["mode"]),
            "request": session_data["user_request"][:300],
            "wave": current_wave + 1,
            "total_waves": len(plan),
            "task": current_task,
            "progress": f"{len(completed)}/{sum(len(w.get('tasks', [])) for w in plan)} tasks done",
        }

        # Add relevant decisions (only non-delegated, truncated)
        key_decisions = {}
        for area_id, d in decisions.items():
            if not d.get("delegated"):
                key_decisions[area_id] = d["answer"][:150]
        if key_decisions:
            context["decisions"] = key_decisions

        return context

    def build_resume_context(self, session_data: dict) -> dict:
        """Build context for resuming a session after context reset."""
        decisions = json.loads(session_data.get("decisions", "{}"))
        completed = json.loads(session_data.get("completed_tasks", "[]"))
        plan = json.loads(session_data.get("plan", "[]"))

        total_tasks = sum(len(w.get("tasks", [])) for w in plan)

        return {
            "session_id": session_data["id"],
            "mode": session_data["mode"],
            "status": session_data["status"],
            "request": session_data["user_request"][:300],
            "progress": f"{len(completed)}/{total_tasks} tasks done",
            "current_wave": session_data.get("current_wave", 0) + 1,
            "decisions_count": len(decisions),
            "escalation": session_data.get("escalation_reason"),
        }


# ---------------------------------------------------------------------------
# Synapse orchestrator — ties everything together
# ---------------------------------------------------------------------------

class SynapseEngine:
    """Main orchestrator for Synapse workflow sessions."""

    def __init__(self, db, embeddings_service=None):
        self.db = db
        self.discussion = DiscussionEngine(embeddings_service)
        self.planner = Planner()
        self.context = ContextAssembler()

    async def new_session(self, project_id: str, mode: str, user_request: str) -> dict:
        """Start a new workflow session. Returns first question or error."""
        if mode not in MODES:
            return {"error": f"Unknown mode: {mode}. Available: {', '.join(MODES.keys())}"}

        session = await self.db.create_workflow_session(project_id, mode, user_request)

        # Get first discussion question
        session_data = self._session_to_dict(session)
        question = await self.discussion.get_next_question(session_data)

        return {
            "session_id": session.id,
            "mode": MODES[mode]["name"],
            "status": "discussing",
            "question": question,
        }

    async def answer(self, session_id: str, area_id: str, answer: str) -> dict:
        """Process an answer to a discussion question.

        Returns next question, or signals transition to planning.
        """
        session = await self.db.get_workflow_session(session_id)
        if not session:
            return {"error": "Session not found"}

        if session.status != "discussing":
            return {"error": f"Session is in '{session.status}' state, not discussing"}

        session_data = self._session_to_dict(session)

        # Process the answer
        decisions = await self.discussion.process_answer(session_data, area_id, answer)

        # Check for escalation
        escalation = self.planner.check_escalation(session.mode, decisions, session.user_request)
        if escalation and escalation["blocking"]:
            await self.db.update_workflow_session(
                session_id,
                decisions=json.dumps(decisions),
                status="escalated",
                escalation_reason=escalation["description"],
            )
            return {
                "session_id": session_id,
                "status": "escalated",
                "escalation": escalation,
                "message": f"Blocked: {escalation['description']}. Please clarify before proceeding.",
            }

        # Save decisions
        await self.db.update_workflow_session(session_id, decisions=json.dumps(decisions))

        # Get next question
        session_data["decisions"] = json.dumps(decisions)
        question = await self.discussion.get_next_question(session_data)

        if question:
            return {
                "session_id": session_id,
                "status": "discussing",
                "question": question,
            }

        # All questions resolved — generate plan
        plan = self.planner.generate_plan(session.mode, decisions, session.user_request)
        await self.db.update_workflow_session(
            session_id,
            status="executing",
            plan=json.dumps(plan),
            current_wave=0,
            current_task=0,
        )

        return {
            "session_id": session_id,
            "status": "executing",
            "message": "Discussion complete. Plan generated.",
            "plan_summary": {
                "waves": len(plan),
                "total_tasks": sum(len(w.get("tasks", [])) for w in plan),
            },
        }

    async def get_task(self, session_id: str) -> dict:
        """Get the current task with token-budgeted context."""
        session = await self.db.get_workflow_session(session_id)
        if not session:
            return {"error": "Session not found"}

        if session.status not in ("executing", "paused"):
            return {"error": f"Session is '{session.status}', not executing"}

        session_data = self._session_to_dict(session)
        return self.context.build_task_context(session_data)

    async def complete_task(self, session_id: str, task_id: str, notes: str = "") -> dict:
        """Mark a task as completed and advance to next."""
        session = await self.db.get_workflow_session(session_id)
        if not session:
            return {"error": "Session not found"}

        plan = json.loads(session.plan)
        completed = json.loads(session.completed_tasks)
        current_wave = session.current_wave
        current_task_idx = session.current_task

        # Mark task completed
        completed.append({
            "task_id": task_id,
            "notes": notes[:500],
            "completed_at": datetime.utcnow().isoformat(),
        })

        # Advance to next task
        if plan and current_wave < len(plan):
            wave_tasks = plan[current_wave].get("tasks", [])
            if current_task_idx + 1 < len(wave_tasks):
                current_task_idx += 1
            else:
                # Move to next wave
                current_wave += 1
                current_task_idx = 0

        # Check if all done
        total_tasks = sum(len(w.get("tasks", [])) for w in plan)
        is_done = len(completed) >= total_tasks

        new_status = "completed" if is_done else "executing"

        await self.db.update_workflow_session(
            session_id,
            completed_tasks=json.dumps(completed),
            current_wave=current_wave,
            current_task=current_task_idx,
            status=new_status,
        )

        if is_done:
            mode = MODES.get(session.mode, {})
            return {
                "session_id": session_id,
                "status": "completed",
                "message": "All tasks completed.",
                "verification_criteria": mode.get("verification_criteria", []),
                "total_completed": len(completed),
            }

        return {
            "session_id": session_id,
            "status": "executing",
            "completed_count": len(completed),
            "total_tasks": total_tasks,
            "next_wave": current_wave + 1,
            "next_task_index": current_task_idx,
        }

    async def escalate(self, session_id: str, reason: str) -> dict:
        """Pause the session with an escalation reason."""
        session = await self.db.get_workflow_session(session_id)
        if not session:
            return {"error": "Session not found"}

        await self.db.update_workflow_session(
            session_id,
            status="escalated",
            escalation_reason=reason[:500],
        )

        return {
            "session_id": session_id,
            "status": "escalated",
            "reason": reason,
            "message": "Session paused. Resolve the issue and resume.",
        }

    async def resume(self, session_id: str) -> dict:
        """Resume a session — returns compact state for context restoration."""
        session = await self.db.get_workflow_session(session_id)
        if not session:
            return {"error": "Session not found"}

        session_data = self._session_to_dict(session)

        if session.status == "escalated":
            # Un-escalate and return to previous state
            plan = json.loads(session.plan)
            new_status = "executing" if plan else "discussing"
            await self.db.update_workflow_session(
                session_id,
                status=new_status,
                escalation_reason=None,
            )
            session_data["status"] = new_status

        context = self.context.build_resume_context(session_data)

        # If executing, also include current task
        if session_data["status"] in ("executing",):
            task_context = self.context.build_task_context(session_data)
            context["current_task"] = task_context

        return context

    def list_modes(self) -> List[dict]:
        """Return available modes with descriptions."""
        return [
            {"id": m["id"], "name": m["name"], "description": m["description"]}
            for m in MODES.values()
        ]

    def _session_to_dict(self, session) -> dict:
        return {
            "id": session.id,
            "project_id": session.project_id,
            "mode": session.mode,
            "status": session.status,
            "user_request": session.user_request,
            "decisions": session.decisions,
            "plan": session.plan,
            "current_wave": session.current_wave,
            "current_task": session.current_task,
            "completed_tasks": session.completed_tasks,
            "escalation_reason": session.escalation_reason,
            "context_snapshot": session.context_snapshot,
        }
