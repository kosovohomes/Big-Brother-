// Screenshot the architecture diagram HTML at 2x device scale (300dpi print quality).
const path = require('path');
let chromium = null;
const candidates = [
  'playwright',
  'playwright-core',
  path.join('/home/z/my-project/skills/pdf/scripts', 'node_modules', 'playwright'),
  path.join('/home/z/my-project/skills/pdf/scripts', 'node_modules', 'playwright-core'),
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright',
];
for (const c of candidates) {
  try { chromium = require(c).chromium; if (chromium) { console.log('using', c); break; } } catch (e) {}
}
if (!chromium) { console.error('NO_PLAYWRIGHT'); process.exit(2); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(__dirname, 'diagram.html'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.resolve(__dirname, 'diagram.png') });
  await browser.close();
  console.log('diagram.png written');
})();
