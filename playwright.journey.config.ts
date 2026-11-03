import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/journey',outputDir:'test-results/journey-browser',timeout:240000,workers:1,
  use:{baseURL:'http://127.0.0.1:3157',headless:true,trace:'off',screenshot:'only-on-failure'},
  webServer:{command:'npm run local:serve',url:'http://127.0.0.1:3157/api/health',reuseExistingServer:false,timeout:30000},
});
