import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

const manifestV3 = {
  manifest_version: 3,
  name: "Personal Second Brain",
  version: "0.2.0",
  description: "Your AI-enhanced personal knowledge assistant",
  permissions: [
    "activeTab",
    "storage",
    "declarativeNetRequest",
    "notifications",
    "contextMenus",
    "scripting"
  ],
  host_permissions: [
    "<all_urls>"
  ],
  action: {
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  background: {
    service_worker: "background.js"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_end"
    }
  ],
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  options_page: "options.html"
};

const manifestV2 = {
  manifest_version: 2,
  name: "Personal Second Brain",
  version: "0.2.0",
  description: "Your AI-enhanced personal knowledge assistant",
  permissions: [
    "activeTab",
    "storage",
    "webRequest",
    "webRequestBlocking",
    "<all_urls>",
    "notifications",
    "contextMenus"
  ],
  browser_action: {
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  background: {
    scripts: ["background.js"],
    persistent: false
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_end"
    }
  ],
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  options_page: "options.html"
};

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox';
  const manifest = isFirefox ? manifestV2 : manifestV3;

  const distDir = resolve(__dirname, 'dist');
  const writeManifest = () => {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      resolve(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
  };

  // Copy static assets that are not Rollup inputs
  const copyStaticAssets = () => {
    const iconsSrc = resolve(__dirname, 'icons');
    const iconsDst = resolve(distDir, 'icons');
    if (fs.existsSync(iconsSrc)) {
      fs.mkdirSync(iconsDst, { recursive: true });
      for (const file of fs.readdirSync(iconsSrc)) {
        fs.copyFileSync(resolve(iconsSrc, file), resolve(iconsDst, file));
      }
    }
    const cssSrc = resolve(__dirname, 'content.css');
    if (fs.existsSync(cssSrc)) {
      fs.copyFileSync(cssSrc, resolve(distDir, 'content.css'));
    }
  };
  copyStaticAssets();

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'background.js'),
          content: resolve(__dirname, 'content.js'),
          popup: resolve(__dirname, 'popup.html'),
          options: resolve(__dirname, 'options.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]'
        }
      }
    },
    plugins: [
      {
        name: 'copy-static-assets',
        // emptyOutDir 会清掉配置期写入的 manifest，必须在 closeBundle 重写
        closeBundle: () => { writeManifest(); copyStaticAssets(); },
      }
    ]
  };
});
