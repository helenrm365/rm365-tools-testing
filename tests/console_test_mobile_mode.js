// ===================================================================
// Order Fulfillment Mobile Mode Auto-Toggle Test Script
// ===================================================================
// Paste this into the browser console on the order fulfillment page
// to test the automatic mobile mode toggling based on window size.
// ===================================================================

async function testMobileModeAutoToggle() {
  console.clear();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 Order Fulfillment Mobile Mode Auto-Toggle Test');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const toggle = document.getElementById('mobileModeToggle');
  const body = document.body;
  const container = document.querySelector('.order-fulfillment');
  const mobileColumnTabs = document.getElementById('mobileColumnTabs');
  
  if (!toggle) {
    console.error('❌ Mobile mode toggle not found!');
    return;
  }
  
  function getCurrentState() {
    return {
      windowWidth: window.innerWidth,
      toggleChecked: toggle.checked,
      hasMobileClass: body.classList.contains('mobile-mode'),
      hasActiveClass: container?.classList.contains('mobile-mode-active'),
      tabsVisible: mobileColumnTabs ? window.getComputedStyle(mobileColumnTabs).display !== 'none' : false
    };
  }
  
  function logState(label, state) {
    console.log(`\n${label}:`);
    console.log(`  Window Width: ${state.windowWidth}px`);
    console.log(`  Toggle Checked: ${state.toggleChecked ? '✓ ON' : '✗ OFF'}`);
    console.log(`  Body 'mobile-mode' class: ${state.hasMobileClass ? '✓ YES' : '✗ NO'}`);
    console.log(`  Container 'mobile-mode-active' class: ${state.hasActiveClass ? '✓ YES' : '✗ NO'}`);
    console.log(`  Mobile tabs visible: ${state.tabsVisible ? '✓ YES' : '✗ NO'}`);
  }
  
  function verifyState(testName, expected, actual) {
    const passed = 
      actual.toggleChecked === expected.mobileMode &&
      actual.hasMobileClass === expected.mobileMode &&
      actual.hasActiveClass === expected.mobileMode &&
      actual.tabsVisible === expected.mobileMode;
    
    if (passed) {
      console.log(`  ✅ ${testName}: PASS`);
    } else {
      console.log(`  ❌ ${testName}: FAIL`);
      if (actual.toggleChecked !== expected.mobileMode) {
        console.log(`     - Toggle should be ${expected.mobileMode ? 'ON' : 'OFF'} but is ${actual.toggleChecked ? 'ON' : 'OFF'}`);
      }
      if (actual.hasMobileClass !== expected.mobileMode) {
        console.log(`     - Body mobile-mode class should be ${expected.mobileMode ? 'present' : 'absent'}`);
      }
      if (actual.hasActiveClass !== expected.mobileMode) {
        console.log(`     - Container mobile-mode-active class should be ${expected.mobileMode ? 'present' : 'absent'}`);
      }
      if (actual.tabsVisible !== expected.mobileMode) {
        console.log(`     - Mobile tabs should be ${expected.mobileMode ? 'visible' : 'hidden'}`);
      }
    }
    
    return passed;
  }
  
  // Test 1: Current state
  console.log('\n📊 Test 1: Current State');
  console.log('─────────────────────────────────────────────────────────');
  const currentState = getCurrentState();
  logState('Current State', currentState);
  
  const expectedMobileMode = currentState.windowWidth <= 768;
  console.log(`\n  Expected mobile mode: ${expectedMobileMode ? 'ON' : 'OFF'} (breakpoint: ≤768px)`);
  verifyState('Initial State', { mobileMode: expectedMobileMode }, currentState);
  
  // Test 2: Manual toggle (to verify it still works)
  console.log('\n\n📊 Test 2: Manual Toggle Override');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Testing that manual toggle still works...');
  
  const originalState = toggle.checked;
  toggle.checked = !originalState;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const manualState = getCurrentState();
  logState('After Manual Toggle', manualState);
  verifyState('Manual Toggle', { mobileMode: !originalState }, manualState);
  
  // Restore original state
  toggle.checked = originalState;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Instructions for manual resize test
  console.log('\n\n📊 Test 3: Resize Window Test');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Now manually resize the browser window to test auto-toggle:');
  console.log('\n  1️⃣  Make window WIDE (>768px)');
  console.log('     Expected: Mobile mode should turn OFF automatically');
  console.log('\n  2️⃣  Make window NARROW (≤768px)');
  console.log('     Expected: Mobile mode should turn ON automatically');
  console.log('\n  3️⃣  Try exactly 768px width');
  console.log('     Expected: Mobile mode should be ON (breakpoint is ≤768px)');
  console.log('\n  After resizing, run this command to check the state:');
  console.log('  testMobileModeAutoToggle.checkState()');
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📝 Test Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✓ Auto-toggle is based on window width (≤768px = mobile)');
  console.log('✓ Manual toggle still works for overrides');
  console.log('✓ Resize the window to verify automatic toggling');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Return helper function
  return {
    checkState: () => {
      const state = getCurrentState();
      const expected = state.windowWidth <= 768;
      console.log('\n📊 Current State Check');
      console.log('─────────────────────────────────────────────────────────');
      logState('Current State', state);
      console.log(`\n  Expected mobile mode: ${expected ? 'ON' : 'OFF'} (breakpoint: ≤768px)`);
      verifyState('Resize Test', { mobileMode: expected }, state);
      console.log('');
    }
  };
}

// Run the test
window.testMobileModeAutoToggle = testMobileModeAutoToggle;
console.log('🧪 Mobile Mode Auto-Toggle Test Loaded!');
console.log('Run: testMobileModeAutoToggle()');
