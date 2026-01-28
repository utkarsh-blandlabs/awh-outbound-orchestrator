/**
 * RESTORE SCRIPT - Restore answered_calls from backup
 *
 * IMPORTANT: This script requires backup files to restore from.
 *
 * If you have backups of your statistics files, place them in:
 *   data/statistics-backup/
 *
 * Then run: npx ts-node scripts/restore-answered-calls-from-backup.ts
 *
 * If you don't have backups, you cannot restore the answered_calls values.
 * The data was lost when the buggy fix script was run.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface Statistics {
  date: string;
  answered_calls: number;
  [key: string]: any;
}

const DATA_DIR = join(process.cwd(), 'data');
const STATISTICS_DIR = join(DATA_DIR, 'statistics');
const BACKUP_DIR = join(DATA_DIR, 'statistics-backup');

function main() {
  console.log('🔄 Restoring answered_calls from backup...\n');

  if (!existsSync(BACKUP_DIR)) {
    console.error('❌ ERROR: Backup directory not found:', BACKUP_DIR);
    console.error('\nYou need to:');
    console.error('1. Create data/statistics-backup/ directory');
    console.error('2. Copy your backup statistics files there');
    console.error('3. Run this script again\n');
    process.exit(1);
  }

  const backupFiles = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('stats_') && f.endsWith('.json'));

  if (backupFiles.length === 0) {
    console.error('❌ No backup files found in', BACKUP_DIR);
    process.exit(1);
  }

  console.log(`📁 Found ${backupFiles.length} backup files\n`);

  let restoredCount = 0;

  for (const file of backupFiles) {
    try {
      const backupPath = join(BACKUP_DIR, file);
      const currentPath = join(STATISTICS_DIR, file);

      // Read backup
      const backup: Statistics = JSON.parse(readFileSync(backupPath, 'utf-8'));

      // Read current
      if (!existsSync(currentPath)) {
        console.log(`⚠️  ${file}: No current file, skipping`);
        continue;
      }

      const current: Statistics = JSON.parse(readFileSync(currentPath, 'utf-8'));

      // Restore answered_calls
      current.answered_calls = backup.answered_calls;
      current.last_updated = new Date().toISOString();

      // Recalculate rates
      if (current.completed_calls > 0) {
        current.transfer_rate = Number(((current.transferred_calls / current.completed_calls) * 100).toFixed(2));
      }

      // Save
      writeFileSync(currentPath, JSON.stringify(current, null, 2), 'utf-8');

      console.log(`✅ ${backup.date}: Restored ${backup.answered_calls} answered_calls`);
      restoredCount++;
    } catch (error: any) {
      console.error(`❌ Error restoring ${file}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Restored ${restoredCount} of ${backupFiles.length} files`);
  console.log('='.repeat(50));
}

main();
