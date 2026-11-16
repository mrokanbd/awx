import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './', // রিলেটিভ পাথ ব্যবহার করায় যেকোনো ডোমেইন বা সাব-ফোল্ডারে চলবে
  plugins: [
    react(),
    // বিল্ড ও ডেভেলপমেন্টের সময় স্বয়ংক্রিয়ভাবে Wasm ফাইলগুলো কপি করবে
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@litertjs/core/wasm/*',
          dest: 'wasm'
        }
      ]
    })
  ],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@litertjs/core']
  }
});
