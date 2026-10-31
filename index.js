/**
 * 原生APK编译闸 · 插件（Host 侧，零依赖，无构建）
 *
 * 来源：主人 2026-10-29 发来的《Smart Agent原生APK编译skill》13KB 血账（三路线/十坑/发版七自查）。
 * 本机没有 JDK / ANDROID_HOME / Gradle / keystore——真开编当场炸。按"死件不装活"，
 * 这里只铸能真跑的三件：工具链体检、项目鉴路、发版机械自查；编译命令写进区块待工具链到位。
 *
 * @module dsh-apk-gate
 */

import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'ql-apk'

export const inject = ['systemPrompt', 'tools']

const SECTION_NAME = 'ql:apk'

const DEFAULTS = Object.freeze({ order: 170, tool: true, enabled: true })

function normalizeConfig(config) {
  const raw = config ?? {}
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error('ql-apk: config.enabled must be a boolean')
  if (raw.tool !== undefined && typeof raw.tool !== 'boolean') throw new Error('ql-apk: config.tool must be a boolean')
  if (raw.order !== undefined && (typeof raw.order !== 'number' || !Number.isFinite(raw.order))) throw new Error('ql-apk: config.order must be a finite number')
  if (raw.root !== undefined && (typeof raw.root !== 'string' || raw.root.trim() === '')) throw new Error('ql-apk: config.root must be a non-empty path string')
  return {
    order: raw.order ?? DEFAULTS.order,
    tool: raw.tool ?? DEFAULTS.tool,
    root: raw.root === undefined ? undefined : raw.root.trim(),
    enabled: raw.enabled !== false,
  }
}

function isWorkspace(dir) {
  try {
    return existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'scripts'))
      && (existsSync(join(dir, 'SOUL.md')) || existsSync(join(dir, 'USER.md')))
  } catch {
    return false
  }
}

function findRoot(configured) {
  const candidates = []
  if (configured !== undefined) candidates.push(configured)
  try {
    candidates.push(dirname(dirname(fileURLToPath(import.meta.url))))
  } catch {
    /* 非文件装法 */
  }
  let dir = process.cwd()
  for (let hop = 0; hop < 6; hop += 1) {
    candidates.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  candidates.push('~//Smart Agentharness')
  for (const candidate of candidates) {
    if (isWorkspace(candidate)) return candidate
  }
  return candidates[0]
}

function runFile(cmd, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        code: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1),
        out: `${stdout ?? ''}${stderr ?? ''}`.trim(),
      })
    })
  })
}

function clip(text, limit) {
  const flat = String(text ?? '').replace(/\s+\n/g, '\n').trim()
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat
}

/** 工具链体检：存在性判定，不做"一定编得过"的承诺。 */
async function toolchain(root) {
  const lines = ['【APK工具链体检】']
  const java = await runFile('java', ['-version'], root, 10000)
  lines.push(`JDK：${java.ok ? '在（' + clip(java.out.split('\n')[0], 60) + '）' : '缺（java 命令不在）'}`)
  const sdkCandidates = [process.env.ANDROID_HOME, join(root, 'android-sdk'), join(process.env.HOME ?? '/root', 'android-sdk')].filter(Boolean)
  const sdk = sdkCandidates.find(path => existsSync(path))
  lines.push(`SDK：${sdk === undefined ? '缺（ANDROID_HOME 未设且常见路径无 android-sdk）' : '在（' + sdk + '）'}`)
  let buildTools = []
  if (sdk !== undefined) {
    try {
      buildTools = await readdir(join(sdk, 'build-tools'))
    } catch {
      buildTools = []
    }
  }
  lines.push(`build-tools：${buildTools.length > 0 ? buildTools.join('、') : '读不出/缺'}`)
  const gradle = await runFile('gradle', ['-v'], root, 15000)
  lines.push(`Gradle：${gradle.ok ? '在' : '缺（PATH 无 gradle）'}`)
  const keystores = ['apps/keystore/Smart Agent帝国.keystore', 'apps/keystore'].filter(rel => existsSync(join(root, rel)))
  lines.push(`keystore：${keystores.length > 0 ? '在（' + keystores[0] + '）' : '缺'}`)
  const ready = java.ok && sdk !== undefined && gradle.ok
  lines.push('', ready
    ? '结论：三件齐（JDK+SDK+Gradle），可开编——但真机验装仍不可省。'
    : '结论：⛔ 缺件，禁开编——先补工具链再谈编译（死件不装活）。')
  lines.push('路线提示：纯Java+XML 走 aapt2 全离线；Kotlin+Compose 走 Gradle（首次拉依赖 200-400MB）；C++ 走 NDK。')
  return lines.join('\n')
}

/** 项目鉴路：嗅探路线并列缺件。 */
async function detect(root, target) {
  const dir = target === '' ? root : (target.startsWith('/') ? target : join(root, target))
  const has = rel => existsSync(join(dir, rel))
  const lines = [`【项目鉴路】${dir}`]
  if (!existsSync(dir)) return `⛔ 目录不存在：${target}`
  const manifest = has('app/src/main/AndroidManifest.xml') ? 'app/src/main/AndroidManifest.xml'
    : (has('src/main/AndroidManifest.xml') ? 'src/main/AndroidManifest.xml' : undefined)
  const gradleRoot = has('build.gradle.kts') || has('build.gradle')
  const gradleApp = has('app/build.gradle.kts') || has('app/build.gradle')
  const ndk = has('CMakeLists.txt') || has('app/src/main/cpp') || has('jni')
  const composeHit = await runFile('rg', ['-l', 'androidx\\.compose', '--glob', '*.kt', '.'], dir, 20000)
  const compose = composeHit.ok && composeHit.out !== ''
  const route = compose ? 'Kotlin+Compose（Gradle）'
    : gradleRoot || gradleApp ? 'Gradle（Java/Kotlin）'
      : ndk ? 'C++ NDK（aapt2 + cmake 交叉编）'
        : manifest !== undefined ? '纯Java aapt2 手动链'
          : '判不出（无 gradle/manifest/CMake）'
  lines.push(`路线：${route}`)
  lines.push(`manifest：${manifest ?? '缺'}`)
  const missing = []
  if (manifest === undefined) missing.push('AndroidManifest.xml')
  if (gradleRoot && !has('local.properties')) missing.push('local.properties（sdk.dir）')
  if (gradleRoot && !has('gradle.properties')) missing.push('gradle.properties（jvmargs≥2048m）')
  let launcher = false
  try {
    const resDirs = await readdir(join(dir, 'app/src/main/res')).catch(() => [])
    for (const sub of resDirs) {
      if (sub.startsWith('mipmap')) {
        const files = await readdir(join(dir, 'app/src/main/res', sub)).catch(() => [])
        if (files.some(name => name.startsWith('ic_launcher'))) launcher = true
      }
    }
  } catch {
    launcher = false
  }
  if (!launcher) missing.push('ic_launcher（res/mipmap-*）')
  lines.push(`缺件 ${missing.length} 项：${missing.length === 0 ? '无' : missing.join('、')}`)
  if (route.includes('Compose')) {
    lines.push('版本配对（错一档编不过）：AGP 8.2.2 ↔ Kotlin 1.9.22 ↔ Compose Compiler 1.5.8 ↔ compose-bom 2024.02.00 ↔ activity-compose 1.8.2；compileSdk/targetSdk 34·minSdk 26·jvmTarget 1.8。')
  }
  return lines.join('\n')
}

/** 发版机械自查：能机械判的七项。 */
async function audit(root, target) {
  const dir = target === '' ? root : (target.startsWith('/') ? target : join(root, target))
  if (!existsSync(dir)) return `⛔ 目录不存在：${target}`
  const lines = ['【发版前机械自查】']
  let fail = 0
  let warn = 0
  const mark = (ok, text, warnOnly = false) => {
    if (ok) lines.push(`  ✅ ${text}`)
    else if (warnOnly) { warn += 1; lines.push(`  ⚠ ${text}`) } else { fail += 1; lines.push(`  ❌ ${text}`) }
  }
  const manifestPath = existsSync(join(dir, 'app/src/main/AndroidManifest.xml'))
    ? join(dir, 'app/src/main/AndroidManifest.xml')
    : (existsSync(join(dir, 'src/main/AndroidManifest.xml')) ? join(dir, 'src/main/AndroidManifest.xml') : undefined)
  let manifest = ''
  if (manifestPath !== undefined) {
    try {
      manifest = await readFile(manifestPath, 'utf8')
    } catch {
      manifest = ''
    }
  }
  mark(manifestPath !== undefined, '1 manifest 在位（缺则无从打包）')
  mark(/uses-sdk|minSdkVersion/i.test(manifest), '2 uses-sdk 显式写了 minSdk/targetSdk（不写＝安装器报"为旧版设计"）')

  let launcher = false
  try {
    const resRoot = join(dir, 'app/src/main/res')
    for (const sub of await readdir(resRoot)) {
      if (!sub.startsWith('mipmap')) continue
      const files = await readdir(join(resRoot, sub))
      if (files.some(name => name.startsWith('ic_launcher'))) launcher = true
    }
  } catch {
    launcher = false
  }
  mark(launcher, '3 ic_launcher 在位（缺则 aapt2 link 报 resource not found）')

  const gradle = existsSync(join(dir, 'build.gradle.kts')) || existsSync(join(dir, 'build.gradle'))
  if (gradle) {
    let localProps = ''
    try {
      localProps = await readFile(join(dir, 'local.properties'), 'utf8')
    } catch {
      localProps = ''
    }
    mark(/sdk\.dir\s*=/.test(localProps), '4 local.properties 有 sdk.dir（缺则 SDK location not found）', true)
    let gradleProps = ''
    try {
      gradleProps = await readFile(join(dir, 'gradle.properties'), 'utf8')
    } catch {
      gradleProps = ''
    }
    const m = /Xmx(\d+)m/i.exec(gradleProps)
    mark(m !== null && Number(m[1]) >= 2048, `5 gradle.properties jvmargs ≥2048m（当前 ${m === null ? '未写' : m[1] + 'm'}）`, true)
  } else {
    lines.push('  — 非 Gradle 工程，跳过 4/5 两项')
  }

  const child = await runFile('rg', ['--count-matches', 'getChildAt\\(', '--glob', '*.{java,kt}', '.'], dir, 20000)
  const childCount = Number((child.out.match(/(\d+)\s*$/m) ?? [])[1] ?? 0)
  mark(childCount === 0, `6 getChildAt 硬索引 ${childCount} 处（>0 须逐个确认新子视图插入后索引未漂）`, true)

  const vis = await runFile('rg', ['--count-matches', 'setVisibility\\(', '--glob', '*.{java,kt}', '.'], dir, 20000)
  const visCount = Number((vis.out.match(/(\d+)\s*$/m) ?? [])[1] ?? 0)
  mark(visCount === 0, `7 setVisibility ${visCount} 处（套壳容器后须父子联动，GONE 子≠GONE 父）`, true)

  lines.push('', `结论：硬失败 ${fail} 项 · 需人判 ${warn} 项`)
  if (fail > 0) lines.push('⛔ 硬失败未清，禁发版。')
  else if (warn > 0) lines.push('🟡 机械项已过，人判项（索引漂移/父子联动/lambda final/作用域/基线）逐条过完才发。')
  else lines.push('✅ 机械项全过；别忘真机装一次——沙箱没设备，静态自查是唯一防线。')
  return lines.join('\n')
}

function renderSection() {
  return [
    '## 原生APK编译令 · 常驻（三路线·版本配对·十坑·发版七自查）',
    '',
    '**路线三选一**：纯Java+XML→aapt2 手动链（全离线秒出）；Kotlin+Compose→Gradle 8.5+AGP 8.2.2（首次拉依赖 200-400MB）；'
      + 'C++→NDK 交叉编 .so 再合 AAR。**判据**：反复踩 aapt2 坑（d8 NPE/资源错）就切 Gradle，不恋战。',
    '',
    '**版本配对（错一档编不过）**：AGP 8.2.2 ↔ Kotlin 1.9.22 ↔ Compose Compiler 1.5.8 ↔ compose-bom 2024.02.00 ↔ activity-compose 1.8.2；'
      + 'compileSdk/targetSdk 34·minSdk 26·jvmTarget 1.8。',
    '',
    '**十坑速查**：ic_launcher 缺→aapt2 link 报错；依赖慢→阿里云镜像；JDK 版本不匹配；offline 首次禁用；daemon OOM→--no-daemon+jvmargs 2048m；'
      + 'assets 不进包→aapt2 -A；R.java 未生成→--java gen；proto-format 致签名失败；d8 缺库→--lib jmods；签名三库指纹不同→覆盖装失败。',
    '',
    '**发版前七自查**（沙箱无设备，静态自查是唯一防线）：视图索引漂移／套壳父子联动／lambda final／成员与局部作用域／'
      + '行尾注释吞代码／显示层幻觉（一律字节级验，javac 零错才是铁证）／改前存回滚基线。',
    '',
    '**WebView 壳三桥**：文件选择／保存（MediaStore.Downloads）／剪贴板（file:// 下 navigator.clipboard 不可用）；'
      + '调外部 API 先测 CORS（Origin: null 放行=直调，否则走 Java 桥）。',
    '',
    '**判据**：开编前问"三件齐吗（JDK/SDK/Gradle）"、发版前问"七自查过几条"——答不齐不许编、不许发。',
  ].join('\n')
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) {
    ctx.logger?.info?.('ql-apk：主开关关着，未挂载')
    return
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: cfg.order,
    text: () => renderSection(),
  }), 'ql-apk.section()')

  if (cfg.tool) {
    ctx.effect(() => ctx.tools.register({
      name: 'ql_apk',
      description: '原生APK编译闸：体检（JDK/SDK/build-tools/Gradle/keystore 在否，给能否开编结论）、'
        + '项目鉴（按目录嗅探 gradle/compose/ndk/纯Java 路线并列缺件）、发版自查（mechanical 七检）。不代编、不代签。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['体检', '项目鉴', '发版自查'],
            description: '要执行的动作。',
          },
          query: { type: 'string', description: '项目鉴／发版自查＝Android 项目目录（相对工作区或绝对）。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { report: { type: 'string' } },
          required: ['report'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.report }],
      },
      execute: async (args) => {
        const root = findRoot(cfg.root)
        const action = typeof args?.action === 'string' ? args.action : '体检'
        const query = typeof args?.query === 'string' ? args.query.trim() : ''
        try {
          if (action === '体检') return { report: await toolchain(root) }
          if (action === '项目鉴') return { report: await detect(root, query) }
          if (action === '发版自查') return { report: await audit(root, query) }
          return { report: `未知动作：${action}` }
        } catch (error) {
          return { report: `APK闸内部错：${clip(error?.message ?? error, 200)}` }
        }
      },
    }), 'ql-apk.tool()')
  }

  ctx.logger?.info?.('ql-apk：区块 %s 已注册（order=%d）', SECTION_NAME, cfg.order)
}
