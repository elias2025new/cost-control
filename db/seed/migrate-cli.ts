import { connect } from '../../src/lib/db';
import { migrate } from '../../src/lib/migrate';

const db = await connect();
try {
  const ran = await migrate(db);
  console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Already up to date.');
} finally {
  await db.close();
}
