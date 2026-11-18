/**
 * Part of `npm run lint`. Fails if a component uses a raw color instead of a
 * theme token (spec: Site layout and feel > Themes). Theme files in
 * src/theme/ are where raw values belong, so they are skipped.
 *
 * A line that really needs a literal (rare) can end with: tokens-ok
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SCAN = ['src']
const SKIP = [join('src', 'theme')]
const EXTENSIONS = ['.ts', '.tsx', '.css']

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'hex color', pattern: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/ },
  { name: 'color function', pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/ },
]

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const rel = relative(ROOT, path)
    if (SKIP.some((skip) => rel === skip || rel.startsWith(skip + '/'))) continue
    if (statSync(path).isDirectory()) yield* files(path)
    else if (EXTENSIONS.some((ext) => path.endsWith(ext))) yield path
  }
}

const problems: string[] = []
for (const dir of SCAN) {
  for (const file of files(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (line.includes('tokens-ok')) return
      for (const rule of RULES) {
        const match = line.match(rule.pattern)
        if (match) {
          problems.push(`${relative(ROOT, file)}:${index + 1}  ${rule.name} "${match[0]}"`)
        }
      }
    })
  }
}

if (problems.length) {
  console.error('Raw colors found. Use a theme token from src/theme/ instead:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log('Theme tokens: no raw colors in components.')
