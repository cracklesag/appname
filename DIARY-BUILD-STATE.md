# DIARY BUILD STATE — resume anchor

Feature: /diary — To-dos (admin+staff), Notes (admin), Calendar (admin, derived
events with layer filters). If this build was interrupted, do the unchecked
steps IN ORDER against the current working copy; everything checked is already
written and gated.

Design decisions (locked):
- Route /diary, one page, role-aware: admin sees tabs To-dos | Notes | Calendar;
  staff sees ONLY their to-do list (no tabs).
- Data: new tables `todos` + `farm_notes` (migration 20260712_diary.sql).
  user_id = farm owner (house pattern), created_by = author.
  RLS: notes admin-only; todos admin full CRUD, staff SELECT+UPDATE only rows
  assigned_to = auth.uid() (server action only flips done fields).
- Calendar stores NOTHING — events derived live in lib/diary.ts from
  applications + cuts + jobs(due_date) + todos(due_date). Layer filter chips
  persisted in localStorage ('diary.calLayers').
- Nav: 5th FARM item "Diary" (NotebookPen icon) in BottomNav.
- Assignment: farm_members (member_name) drives the assignee picker.

Steps:
- [x] 1. supabase/migrations/20260712_diary.sql (todos + farm_notes + RLS)
- [x] 2. lib/types.ts — Todo + FarmNote interfaces (end of file, additive)
- [x] 3. lib/data.ts — loadTodos, loadNotes (append at end)
- [x] 4. lib/actions.ts — createTodo, toggleTodoDone, deleteTodo, reassignTodo,
        saveNote, deleteNote (append at end of file)
- [x] 5. lib/diary.ts — buildDiaryEvents (pure) + DIARY_LAYERS
- [x] 6. lib/__tests__/diary.test.ts — event derivation tests
- [x] 7. components/TodoList.tsx (client; add form, tick, assign, delete, done-collapse)
- [x] 8. components/NotesPanel.tsx (client; add, edit inline, pin, delete)
- [x] 9. components/DiaryCalendar.tsx (client; month grid, chips, day detail)
- [x] 10. components/DiaryShell.tsx (client; tabs by role)
- [x] 11. app/diary/page.tsx (server; loads + role gate)
- [x] 12. components/BottomNav.tsx — add Diary to FARM_ITEMS
- [x] 13. Gates: tsc, vitest (expect 174 + new diary tests), next build
- [x] 14. zip swardly-diary.zip: migration + all files above + this file
- [x] 15. Home to-do nudge card (app/page.tsx, both roles, shows when open>0)
- [x] 16. Spray layer wired into calendar (app/diary/page.tsx -> sprayDates)

Conventions: assert-once python edits for existing files; new files via
create_file. Styling: .card/.label/btn-primary/btn-ghost, CSS vars
(--forest, --amber, --slurry, --muted, --ink, --line). Mobile-first.
