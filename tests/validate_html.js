// Validate Weather App HTML Structure
// Single file validation for brutalist dark mode weather app

const fs = require('fs');
const path = require('path');

const VALIDATION_RULES = {
  required_elements: [
    { selector: '#weather-display', type: 'container' },
    { selector: '#temperature', type: 'data-display' },
    { selector: '#conditions', type: 'data-display' },
    { selector: '#wind-speed', type: 'data-display' },
    { selector: '#api-status', type: 'status-indicator' }
  ],
  
  required_scripts: [
    { src: 'Open-Meteo API fetch', method: 'fetch' },
    { src: 'weather code mapping', method: 'function' }
  ],
  
  styling_checks: {
    dark_mode: true,
    brutalist_design: true,
    responsive_layout: true
  }
};

function validateHTML(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const results = {};
  
  // Check required elements
  VALIDATION_RULES.required_elements.forEach(rule => {
    const match = html.match(new RegExp(rule.selector.replace('#', '\\#')));
    results[rule.selector] = match ? true : false;
  });
  
  // Check API integration
  results.has_api_fetch = html.includes('fetch') && html.includes('open-meteo');
  
  // Check dark mode styling
  results.dark_mode_css = html.includes('#1a1a1a') || html.includes('background-color: #1a1a1a');
  
  return results;
}

module.exports = { validateHTML, VALIDATION_RULES };
