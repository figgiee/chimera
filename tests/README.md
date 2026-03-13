# Weather App Tests

Test suite for Garden Grove CA weather app using Open-Meteo API.

## Test Files

- `weather_app.spec.js` - Test specifications and validation rules
- `validate_html.js` - HTML structure validator
- `run_tests.js` - Test runner with console output

## Running Tests

```bash
cd C:/Users/sandv/Desktop/chimera/tests
node run_tests.js
```

## Test Coverage

### API Integration
- Open-Meteo endpoint validation
- Garden Grove coordinates (33.7706, -117.9282)
- Weather code to text mapping

### UI Validation
- Required DOM elements
- Brutalist dark mode styling
- Responsive layout checks

### Error Handling
- Network error scenarios
- API timeout handling
- Invalid response boundaries

## Expected Results

All tests should pass when weather_app.html is properly structured with:
- Open-Meteo API fetch integration
- Dark mode CSS (#1a1a1a background)
- Required display elements (#weather-display, #temperature, etc.)
