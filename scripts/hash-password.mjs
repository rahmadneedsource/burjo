// Usage: npm run admin:hash -- "kata sandi rahasia"
// Prints the ADMIN_PASSWORD_HASH value to paste into the env of your host.
import {pbkdf2Sync,randomBytes} from 'node:crypto'

const ROUNDS=210_000
const value=process.argv.slice(2).join(' ').trim()
if(value.length<8){console.error('Kata sandi minimal 8 karakter.');process.exit(1)}
const salt=randomBytes(16)
const hash=pbkdf2Sync(value,salt,ROUNDS,32,'sha256')
console.log(`pbkdf2$sha256$${ROUNDS}$${salt.toString('base64url')}$${hash.toString('base64url')}`)
