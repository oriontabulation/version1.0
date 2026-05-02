import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('/js/draw.js') || id.includes('/js/knockout.js')) return 'draw';
                    if (id.includes('/js/admin.js') || id.includes('/js/teams.js') || id.includes('/js/judges.js')) return 'admin';
                    if (id.includes('/js/speakers.js')) return 'speakers';
                },
            },
        },
    },
});
