const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\HP\\.gemini\\antigravity\\brain\\9f03f2b8-3f89-49d3-b99a-291def48ff08';
const workspaceDir = 'E:\\saral';

const screens = [
  { name: 'home', hash: '#screen=home', file: 'screen-home.png' },
  { name: 'apps', hash: '#screen=apps', file: 'screen-apps.png' },
  { name: 'ask', hash: '#screen=ask', file: 'screen-ask.png' }
];

function capture(screen) {
  return new Promise((resolve, reject) => {
    const htmlUrl = 'file:///' + path.resolve(workspaceDir, 'saral.html').replace(/\\/g, '/') + screen.hash;
    const localTarget = path.join(workspaceDir, screen.file);
    const artifactTarget = path.join(artifactDir, screen.file);

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--virtual-time-budget=4000',
      `--screenshot=${localTarget}`,
      '--window-size=1280,950',
      htmlUrl
    ];

    console.log(`[Capture] Launching Chrome for ${screen.name} -> ${screen.hash}...`);
    execFile(chromePath, args, (err, stdout, stderr) => {
      if (err) {
        console.error(`[Capture Error ${screen.name}]`, err);
        return reject(err);
      }
      if (fs.existsSync(localTarget)) {
        const size = fs.statSync(localTarget).size;
        console.log(`[Capture Success] ${screen.file} written (${size} bytes)`);
        // Copy to artifact directory
        fs.copyFileSync(localTarget, artifactTarget);
        console.log(`[Artifact Copied] -> ${artifactTarget}`);
        resolve({ screen: screen.name, size, path: localTarget, artifactPath: artifactTarget });
      } else {
        reject(new Error(`Screenshot file not generated for ${screen.name}`));
      }
    });
  });
}

async function run() {
  console.log('================================================================');
  console.log(' SARAL — Milestone 2 Real Visual Capture Suite');
  console.log(' Target Screens: Personal Home, Apps Bento, Ask SARAL');
  console.log('================================================================\n');

  for (const s of screens) {
    try {
      await capture(s);
    } catch (e) {
      console.error(`Failed capturing ${s.name}:`, e.message);
    }
  }

  console.log('\n================================================================');
  console.log(' Capture Run Completed.');
  console.log('================================================================');
}

run();

