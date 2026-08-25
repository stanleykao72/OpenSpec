# Backend Plan

## 1. 模型層

- [x] 1.1 在 `account.move` 加 `project_id`
- [x] 1.2 加 `@api.constrains` 驗證跨公司一致性

## 2. 資料搬遷

- [ ] 2.1 migration script 由 line 回填 move
- [ ] 2.2 保留舊欄位為 related，標 deprecated
