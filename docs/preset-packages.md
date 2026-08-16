# Agent 预设包格式

DSH Desktop 使用 `.dshpreset` 文件保存自定义 Agent 预设。文件本质上是 ZIP，但必须包含根级 `manifest.json`，以及 `preset/<id>/` 下的一个或多个预设目录。

```text
manifest.json
preset/
  my-agent/
    agent.cordis.yml
    preset.yml
    skills/
    plugins/
    assets/
```

`manifest.json` 至少包含：

```json
{
  "format": "dsh-preset",
  "version": 1,
  "sourceDshVersion": "0.1.0-rc.6",
  "exportedAt": "2026-08-16T00:00:00.000Z",
  "presets": ["my-agent"]
}
```

导入流程会先读取并校验整个包，再显示结果，用户确认后才写入 `<DSH_HOME>/.agent-presets/`。路径穿越、绝对路径、重复条目、无效 manifest、缺少 `agent.cordis.yml`、过大条目和已有 ID 都会被拒绝；已有文件不会覆盖。导入失败时只清理本次创建的临时目录。

预设和其中的 skills/plugins/assets 属于可执行配置。只导入自己信任的来源，并在导入前检查内容。
