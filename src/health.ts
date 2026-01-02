// Simple health check for Docker
import { DbService } from './services/db.service.js';

async function check() {
  try {
    const db = new DbService(process.env.DB_PATH || './data/grabber.db');
    const stats = db.getStats();
    console.log(`Health OK: ${stats.totalProcessed} tweets processed`);
    process.exit(0);
  } catch (error) {
    console.error('Health check failed:', error);
    process.exit(1);
  }
}

check();
