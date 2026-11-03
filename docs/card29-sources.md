# card29 事实核查

核查日2026-11-03（Asia/Shanghai）。Notion于10月19日发布《Agents, rebuilt to do more for less》，写明单次任务可运行超过24小时（此前约五分钟），并介绍“Review for me”：用单独模型在执行前检查是否安全。帮助中心说明三种审批：Always ask（改内容或使用已连接应用前都问）、Review for me（默认，自行工作，疑似不安全才问）、Skip all（不问）。帮助亦写明Review for me依赖Agent自身检查，不会总与人的判断一致。更新页同日条目可交叉。本次只采用产品描述，不采用成本降幅、速度百分比或“绝大多数用户用不完额度”等营销结论作为辩论前提。未登录实测。

两文均未要求本题必须把默认改为Always ask或必须维持Review for me；默认审批之争是另设规则假想。

https://www.notion.com/blog/notion-ai-more-for-less
https://www.notion.com/help/choose-how-notion-agent-asks-for-your-approval

## 辩论共享背景

真实触发：Notion于2026年10月19日官方宣布重建Agent，单次任务可运行超过24小时（此前约五分钟），并介绍默认的“Review for me”审批：另有模型先筛疑似不安全操作，其余自行继续；帮助中心并列Always ask、Review for me（默认）、Skip all三种。仅阅读公告与帮助，未实测。以下为另设默认规则假想，不是Notion现行强制政策变更：工作区允许Agent改页面、连外部应用；人可离开数小时；三种模式均可选手动切换且事先告知。只能二选一作新会话默认：A默认Review for me；B默认Always ask。不争能否关掉Agent、不设Skip all为默认、不加第三种加权默认。共同前提与承认一般代价不算新让步；无则空数组。

两种默认、人可离开数小时、检查与人不完全一致等场景设定为假想，非客户投诉或厂商承诺变更。第一人称为写稿AI的分析，不冒充Notion产品亲历。

﻿# card29 全历史语义复查

结果：PASS。采用第一次真实尝试。主执行者逐字段阅读六份发言与编辑原回包，按本方全部此前历史核对。另一次本地CLI审读见semantic-audit-attempt-1.output.txt；该审读没有独立联网核查来源或目录完整性。来源核验与历史去重由主执行者负责。辩手、编辑和审读均同提供方，不声称异构独立。

| 发言 | 全部此前历史对照 | 结论 |
| --- | --- | --- |
| A1 | 长任务新会话应默认代审，让已授权任务在人离开后仍能推进 | 开局无让步 |
| B1 | 新会话应默认每步问；“未被判不安全”不能代替对具体改动的授权 | 开局无让步；与A1相反 |
| A2 | 延续A1：明确任务可授权其中必要操作，默认代审让工作持续 | 无新增接受；未改口为每步问 |
| B2 | 延续B1：目标明确≠具体选择已获准；改内容或连外部前应问 | 未接受A的默认代审；承认可选手动切换是共享条件 |
| A3 | 坚持范围内持续执行、疑似不安全再问；分岔口确认不推出每次修改都问 | 无本轮新让步 |
| B3 | 坚持默认Always ask；代审应由用户主动切换 | 无本轮新让步，无假共识 |

双方自报空数组、编辑原数组空、公开卡空，三者一致。编辑stanceBreaks为空；未决点“明确任务范围后，具体操作是否仍需逐项确认”。引文分别逐字来自A3/B3单字段，未改标点。真实新让步0项，完成不等于共识。

事实边界：10月19日是Notion Agents rebuilt公告，距执行15天；帮助中心三种审批与Review for me默认作交叉。未实测，不采用成本/速度营销数字作前提。默认审批之争为另设假想，非厂商强制变更。

全历史避重：见topics.md与history-scan-current。本题争长任务新会话默认审批节奏。card28争客服队列时间戳；card24争对外跟进；card7/8/14/17争权限准入；hot_1023争暂停能力；hot_1029/1101争验收与架构。jingku_launch、zuck_wang与ns01–04亦无同一默认审批冲突。

## 来源原响应SHA-256

- Notion官方：Agents rebuilt to do more for less：c6efe6ecc41a165d8a707a62f36dbb660622be62c8f278259820d54c3a0e7e33；读取时间 2026-11-03T01:23:48.015886+00:00；原页 https://www.notion.com/blog/notion-ai-more-for-less；最终响应 https://www.notion.com/blog/notion-ai-more-for-less。
- Notion帮助：Choose how Notion AI asks for your approval：4970789865015c3ffa188dfc7610ed765e13a9c6b0ae2c16bbc0a3ccc90d9318；读取时间 2026-11-03T01:23:48.015886+00:00；原页 https://www.notion.com/help/choose-how-notion-agent-asks-for-your-approval；最终响应 https://www.notion.com/help/choose-how-notion-agent-asks-for-your-approval。
