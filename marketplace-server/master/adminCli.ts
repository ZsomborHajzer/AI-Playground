// npm run admin:create -- <username>   (password from $ADMIN_PASSWORD or a prompt)
import { createInterface } from 'node:readline/promises'
import { createAdmin } from './auth.ts'
import { masterConfigFromEnv } from './config.ts'
import { openDatabase } from './db.ts'

const username = process.argv[2]
if (!username || !/^[a-zA-Z0-9._-]{2,40}$/.test(username)) {
  console.error('Usage: npm run admin:create -- <username>')
  process.exit(1)
}

let password = process.env.ADMIN_PASSWORD
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  password = await rl.question(`Password for ${username} (min 10 characters): `)
  rl.close()
}

const db = openDatabase(masterConfigFromEnv().dataDir)
try {
  createAdmin(db, username, password)
  console.log(`Admin "${username}" is ready. Sign in at /admin.`)
} catch (e) {
  console.error((e as Error).message)
  process.exitCode = 1
} finally {
  db.close()
}
