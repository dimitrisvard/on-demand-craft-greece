import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
	// Load env file based on `mode` in the current working directory.
	// Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
	const env = loadEnv(mode, process.cwd(), '');
	
	console.log('Loaded environment variables:', {
		region: env.VITE_AWS_REGION,
		bucket: env.VITE_AWS_BUCKET_NAME,
		hasAccessKey: !!env.VITE_AWS_ACCESS_KEY_ID,
		hasSecretKey: !!env.VITE_AWS_SECRET_ACCESS_KEY
	});
	
	return {
		server: {
			host: "::",
			port: 8080,
		},
		preview: {
			port: 8080,
		},
		build: {
			target: 'es2020',
			sourcemap: false,
			minify: 'esbuild',
			rollupOptions: {
				output: {
					manualChunks: {
						vendor: ['react', 'react-dom', 'react-router-dom'],
						ui: ['@radix-ui/react-dialog', '@radix-ui/react-slot', '@radix-ui/react-tooltip'],
					},
				},
			},
		},
		plugins: [
			react(),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		define: {
			'process.env': env,
			'import.meta.env': env
		}
	};
});
