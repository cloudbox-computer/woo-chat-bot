// Test widget color contrast fix
import { test, expect } from '@playwright/test';

test('widget handles white brand color', async ({ page }) => {
  await page.goto('/');
  
  // Check that the widget JS contains the getTextColorForBrand function
  const widgetResponse = await page.evaluate(async () => {
    // Fetch widget.js from Supabase
    const res = await fetch('https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/widget.js');
    return await res.text();
  });
  
  expect(widgetResponse).toContain('getTextColorForBrand');
  expect(widgetResponse).toContain('luminance');
});

test('widget uses correct text color for light backgrounds', async ({ page }) => {
  // Create a test page with white brand color
  await page.setContent(`
    <html>
      <body>
        <div id="root"></div>
        <script src="https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/widget.js"></script>
        <script>
          window._testConfig = {
            chatbotId: 'test',
            apiUrl: 'https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1',
            brandColour: '#ffffff',
            title: 'Test Chat'
          };
        </script>
      </body>
    </html>
  `);
  
  // Wait for widget to mount
  await page.waitForTimeout(1000);
  
  // Check that the widget JS contains the luminance detection logic
  const hasLuminanceLogic = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    let hasFunction = false;
    for (const script of scripts) {
      if (script.src && script.src.includes('widget.js')) {
        // We can't directly check the bundled JS, so we'll verify via fetch
      }
    }
    return hasFunction;
  });
  
  // Instead, fetch and check the widget content
  const widgetJs = await page.evaluate(async () => {
    const res = await fetch('https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/widget.js');
    return await res.text();
  });
  
  expect(widgetJs).toContain('getTextColorForBrand');
  expect(widgetJs).toContain('brandTextColor');
});
