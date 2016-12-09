This module exports a number of ‘commands‘, which are building block
functions that encapsulate an editing action. A command function takes
an editor state and _optionally_ an `onAction` function that it can
use to take an action. It should return a boolean that indicates
whether it could perform any action. When no `onAction` callback is
passed, the command should do a 'dry run', determining whether it is
applicable, but not actually doing anything.

These are mostly used to bind keys to, and to define menu items.

@chainCommands
@deleteSelection
@joinBackward
@joinForward
@joinUp
@joinDown
@lift
@newlineInCode
@exitCode
@createParagraphNear
@liftEmptyBlock
@splitBlock
@selectParentNode
@wrapIn
@setBlockType
@toggleMark
@autoJoin
@baseKeymap
