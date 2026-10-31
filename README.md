# dsh-apk-gate · 原生APK编译闸（插件）

主人 2026-10-29 发来《Smart Agent原生APK编译skill》13KB 血账，做成插件。

## 为什么不做编译动作

本机 **无 JDK、无 ANDROID_HOME、无 Gradle、无 keystore**——真开编就是当场炸。
按"死件不装活"，本插件只铸三件能真跑的：体检、鉴路、发版自查；编译命令写进区块，等工具链到位再跑。

## 区块 `ql:apk`（默认排序 170）

三路线路由（纯Java aapt2／Kotlin+Compose Gradle／C++ NDK）·版本配对表（AGP 8.2.2 ↔ Kotlin 1.9.22 ↔
Compose Compiler 1.5.8 ↔ bom 2024.02.00）·十坑速查·发版前七自查·签名指纹三库之别·WebView 三桥与 CORS 判据。

## 工具 `ql_apk`

| action | 干什么 |
|---|---|
| `体检` | JDK／ANDROID_HOME／build-tools／Gradle／keystore 在否，给"能否开编"结论 |
| `项目鉴` | 按项目目录嗅探路线（gradle/compose/ndk/pure-java），列缺件 |
| `发版自查` | 机械七检：manifest uses-sdk、ic_launcher、local.properties、jvmargs、getChildAt 硬索引、setVisibility 联动、回滚基线 |

## 诚实边界

- 体检是**存在性**判定，不是"一定编得过"。
- 发版自查只覆盖能机械判的七项；第 3/4/6 项（lambda final、作用域、显示层幻觉）需人判，工具只点名。
- 编译产物与签名必须真机验；本插件不代编、不代签。
