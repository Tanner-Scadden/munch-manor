# `src/ui/`

HTML parts several features share, as `render/` is the canvas drawing they share.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                                   | What it holds                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menuParts.ts`, `cornerButtons.ts`     | Pixel icons, key caps, CSS percents, a hero's prop, the rank tag and badge image, the NEW badge and pip; the close and back buttons every dialog and screen shares                    |
| `rankBadgeView.ts`, `modifiersView.ts` | The badge on the home menu's player and the Profile's rank plate with the next rank's gift, a rank mark, and a Bones count; a modifier's tile, label, and bonus chip, in both lobbies |
| `dareMarkView.ts`                      | The dare ladder's parts in HTML: a mark's label, the lobby pick's seal and number, and the small badge on the Proof Shelf's row and the co-op host's seat                             |
| `easyBreakView.ts`                     | Dare's break clock pill in both lobbies: a clock and its pick, ∞ for none                                                                                                             |
| `dialog.ts`                            | A menu dialog's shell: `dialogShellView`, ui-kit's Dialog with its backdrop and panel around the insides it is handed (`DialogParts`: the title, description, close, and first focus) |
