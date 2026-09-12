// Consistent copy of a live SQLite database. Used by bin/backup.sh.
import { DatabaseSync } from 'node:sqlite';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('Usage: snapshot.js <source.db> <destination.db>');
  process.exit(1);
}

const db = new DatabaseSync(source, { readOnly: true });
db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
db.close();
