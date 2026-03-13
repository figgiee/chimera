#!/usr/bin/env node
// Test Runner for Weather App
// Executes validation and reports results

const { validateHTML } = require('./validate_html');
const fs = require('fs');
const path = require('path');

const TEST_PATH = path.join(__dirname, '../weather_app.html');

function runTests() {
  console.log('Running Weather App Tests...\n');
  
  if (!fs.existsSync(TEST_PATH)) {
    console.error(`ERROR: ${TEST_PATH} not found`);
    process.exit(1);
  }
  
  const results = validateHTML(TEST_PATH);
  
  console.log('=== HTML Structure Validation ===');
  VALIDATION_RULES.required_elements.forEach(rule => {
    const status = results[rule.selector] ? 'PASS' : 'FAIL';
    console.log(`${status}: ${rule.selector}`);
  });
  
  console.log('\n=== API Integration ===');
  console.log(results.has_api_fetch ? 'PASS: Open-Meteo API fetch present' : 'FAIL: Missing API integration');
  
  console.log('\n=== Styling Validation ===');
  console.log(results.dark_mode_css ? 'PASS: Dark mode CSS detected' : 'FAIL: Dark mode not found');
  
  const passCount = Object.values(results).filter(v => v).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passCount}/${totalTests}`);
  
  if (passCount === totalTests) {
    console.log('All tests passed!');
    process.exit(0);
  } else {
    console.log('Some tests failed. Check output above.');
    process.exit(1);
  }
}

runTests();
