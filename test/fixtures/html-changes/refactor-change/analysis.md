# Analysis

## Why

`account.move` 上的 `project_id` 目前掛在 invoice line，導致跨公司報表重複計算。

## Current shape

| 位置 | 欄位 | 問題 |
|------|------|------|
| `account.move.line` | `project_id` | 每列各自為政 |
| `account.move` | 無 | 表頭沒有單一真相 |

## Constraints

- 不得改 `odoo/` 或 `enterprise/`
- 既有 SQL view 依賴舊欄位，需保留讀取相容
