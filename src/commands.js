const {joinPoint, canJoin, findWrapping, liftTarget, canSplit, ReplaceAroundStep} = require("prosemirror-transform")
const {Slice, Fragment} = require("prosemirror-model")
const {Selection, TextSelection, NodeSelection, isSelectable} = require("prosemirror-state")
const {isExtendingCharAt} = require("extending-char")

const {ios, mac} = require("./platform")
const {charCategory} = require("./char")

// :: (EditorState, ?(action: Action)) → bool
// Delete the selection, if there is one.
function deleteSelection(state, onAction) {
  if (state.selection.empty) return false
  if (onAction) onAction(state.tr.replaceSelection().scrollAction())
  return true
}
exports.deleteSelection = deleteSelection

// :: (EditorState, ?(action: Action)) → bool
// If the selection is empty and at the start of a textblock, move
// that block closer to the block before it, by lifting it out of its
// parent or, if it has no parent it doesn't share with the node
// before it, moving it into a parent of that node, or joining it with
// that.
function joinBackward(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset > 0) return false

  // Find the node before this one
  let before, cut
  for (let i = $head.depth - 1; !before && i >= 0; i--) if ($head.index(i) > 0) {
    cut = $head.before(i + 1)
    before = $head.node(i).child($head.index(i) - 1)
  }

  // If there is no node before this, try to lift
  if (!before) {
    let range = $head.blockRange(), target = range && liftTarget(range)
    if (target == null) return false
    if (onAction) onAction(state.tr.lift(range, target).scrollAction())
    return true
  }

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if (before.isLeaf && isSelectable(before) && $head.parent.content.size == 0) {
    if (onAction) {
      let tr = state.tr.delete(cut, cut + $head.parent.nodeSize)
      tr.setSelection(new NodeSelection(tr.doc.resolve(cut - before.nodeSize)))
      onAction(tr.scrollAction())
    }
    return true
  }

  // If the node doesn't allow children, delete it
  if (before.isLeaf) {
    if (onAction) onAction(state.tr.delete(cut - before.nodeSize, cut).scrollAction())
    return true
  }

  // Apply the joining algorithm
  return deleteBarrier(state, cut, onAction)
}
exports.joinBackward = joinBackward

// :: (EditorState, ?(action: Action)) → bool
// If the selection is empty and the cursor is at the end of a
// textblock, move the node after it closer to the node with the
// cursor (lifting it out of parents that aren't shared, moving it
// into parents of the cursor block, or joining the two when they are
// siblings).
function joinForward(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset < $head.parent.content.size) return false

  // Find the node after this one
  let after, cut
  for (let i = $head.depth - 1; !after && i >= 0; i--) {
    let parent = $head.node(i)
    if ($head.index(i) + 1 < parent.childCount) {
      after = parent.child($head.index(i) + 1)
      cut = $head.after(i + 1)
    }
  }

  // If there is no node after this, there's nothing to do
  if (!after) return false

  // If the node doesn't allow children, delete it
  if (after.isLeaf) {
    if (onAction) onAction(state.tr.delete(cut, cut + after.nodeSize).scrollAction())
    return true
  }
  // Apply the joining algorithm
  return deleteBarrier(state, cut, onAction)
}
exports.joinForward = joinForward

// :: (EditorState, ?(action: Action)) → bool
// Delete the character before the cursor, if the selection is empty
// and the cursor isn't at the start of a textblock.
function deleteCharBefore(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset == 0) return false
  if (onAction) {
    let dest = moveBackward($head, "char")
    onAction(state.tr.delete(dest, $head.pos).scrollAction())
  }
  return true
}
exports.deleteCharBefore = deleteCharBefore

// :: (EditorState, ?(action: Action)) → bool
// Delete the word before the cursor, if the selection is empty and
// the cursor isn't at the start of a textblock.
function deleteWordBefore(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset == 0) return false
  if (onAction)
    onAction(state.tr.delete(moveBackward($head, "word"), $head.pos).scrollAction())
  return true
}
exports.deleteWordBefore = deleteWordBefore

// :: (EditorState, ?(action: Action)) → bool
// Delete the character after the cursor, if the selection is empty
// and the cursor isn't at the end of its textblock.
function deleteCharAfter(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset == $head.parent.content.size) return false
  if (onAction)
    onAction(state.tr.delete($head.pos, moveForward($head, "char")).scrollAction())
  return true
}
exports.deleteCharAfter = deleteCharAfter

// :: (EditorState, ?(action: Action)) → bool
// Delete the word after the cursor, if the selection is empty and the
// cursor isn't at the end of a textblock.
function deleteWordAfter(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parentOffset == $head.parent.content.size) return false
  if (onAction)
    onAction(state.tr.delete($head.pos, moveForward($head, "word")).scrollAction())
  return true
}
exports.deleteWordAfter = deleteWordAfter

// :: (EditorState, ?(action: Action)) → bool
// Join the selected block or, if there is a text selection, the
// closest ancestor block of the selection that can be joined, with
// the sibling above it.
function joinUp(state, onAction) {
  let {node, from} = state.selection, point
  if (node) {
    if (node.isTextblock || !canJoin(state.doc, from)) return false
    point = from
  } else {
    point = joinPoint(state.doc, from, -1)
    if (point == null) return false
  }
  if (onAction) {
    let tr = state.tr.join(point)
    if (state.selection.node) tr.setSelection(new NodeSelection(tr.doc.resolve(point - state.doc.resolve(point).nodeBefore.nodeSize)))
    onAction(tr.scrollAction())
  }
  return true
}
exports.joinUp = joinUp

// :: (EditorState, ?(action: Action)) → bool
// Join the selected block, or the closest ancestor of the selection
// that can be joined, with the sibling after it.
function joinDown(state, onAction) {
  let node = state.selection.node, nodeAt = state.selection.from
  let point = joinPointBelow(state)
  if (!point) return false
  if (onAction) {
    let tr = state.tr.join(point)
    if (node) tr.setSelection(new NodeSelection(tr.doc.resolve(nodeAt)))
    onAction(tr.scrollAction())
  }
  return true
}
exports.joinDown = joinDown

// :: (EditorState, ?(action: Action)) → bool
// Lift the selected block, or the closest ancestor block of the
// selection that can be lifted, out of its parent node.
function lift(state, onAction) {
  let {$from, $to} = state.selection
  let range = $from.blockRange($to), target = range && liftTarget(range)
  if (target == null) return false
  if (onAction) onAction(state.tr.lift(range, target).scrollAction())
  return true
}
exports.lift = lift

// :: (EditorState, ?(action: Action)) → bool
// If the selection is in a node whose type has a truthy
// [`code`](#model.NodeSpec.code) property in its spec, replace the
// selection with a newline character.
function newlineInCode(state, onAction) {
  let {$from, $to, node} = state.selection
  if (node) return false
  if (!$from.parent.type.spec.code || $to.pos >= $from.end()) return false
  if (onAction) onAction(state.tr.insertText("\n").scrollAction())
  return true
}
exports.newlineInCode = newlineInCode

// :: (EditorState, ?(action: Action)) → bool
// If a block node is selected, create an empty paragraph before (if
// it is its parent's first child) or after it.
function createParagraphNear(state, onAction) {
  let {$from, $to, node} = state.selection
  if (!node || !node.isBlock) return false
  let type = $from.parent.defaultContentType($to.indexAfter())
  if (!type || !type.isTextblock) return false
  if (onAction) {
    let side = ($from.parentOffset ? $to : $from).pos
    let tr = state.tr.insert(side, type.createAndFill())
    tr.setSelection(new TextSelection(tr.doc.resolve(side + 1)))
    onAction(tr.scrollAction())
  }
  return true
}
exports.createParagraphNear = createParagraphNear

// :: (EditorState, ?(action: Action)) → bool
// If the cursor is in an empty textblock that can be lifted, lift the
// block.
function liftEmptyBlock(state, onAction) {
  let {$head, empty} = state.selection
  if (!empty || $head.parent.content.size) return false
  if ($head.depth > 1 && $head.after() != $head.end(-1)) {
    let before = $head.before()
    if (canSplit(state.doc, before)) {
      if (onAction) onAction(state.tr.split(before).scrollAction())
      return true
    }
  }
  let range = $head.blockRange(), target = range && liftTarget(range)
  if (target == null) return false
  if (onAction) onAction(state.tr.lift(range, target).scrollAction())
  return true
}
exports.liftEmptyBlock = liftEmptyBlock

// :: (EditorState, ?(action: Action)) → bool
// Split the parent block of the selection. If the selection is a text
// selection, also delete its content.
function splitBlock(state, onAction) {
  let {$from, $to, node} = state.selection
  if (node && node.isBlock) {
    if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false
    if (onAction) onAction(state.tr.split($from.pos).scrollAction())
    return true
  }

  if (onAction) {
    let atEnd = $to.parentOffset == $to.parent.content.size
    let tr = state.tr.delete($from.pos, $to.pos)
    let deflt = $from.depth == 0 ? null : $from.node(-1).defaultContentType($from.indexAfter(-1))
    let types = atEnd ? [{type: deflt}] : null
    let can = canSplit(tr.doc, $from.pos, 1, types)
    if (!types && !can && canSplit(tr.doc, $from.pos, 1, [{type: deflt}])) {
      types = [{type: deflt}]
      can = true
    }
    if (can) {
      tr.split($from.pos, 1, types)
      if (!atEnd && !$from.parentOffset && $from.parent.type != deflt &&
          $from.node(-1).canReplace($from.index(-1), $from.indexAfter(-1), Fragment.from(deflt.create(), $from.parent)))
        tr.setNodeType($from.before(), deflt)
    }
    onAction(tr.scrollAction())
  }
  return true
}
exports.splitBlock = splitBlock

// :: (EditorState, ?(action: Action)) → bool
// Move the selection to the node wrapping the current selection, if
// any. (Will not select the document node.)
function selectParentNode(state, onAction) {
  let sel = state.selection, pos
  if (sel.node) {
    if (!sel.$from.depth) return false
    pos = sel.$from.before()
  } else {
    let same = sel.$head.sameDepth(sel.$anchor)
    if (same == 0) return false
    pos = sel.$head.before(same)
  }
  if (onAction) onAction(new NodeSelection(state.doc.resolve(pos)).action())
  return true
}
exports.selectParentNode = selectParentNode

function deleteBarrier(state, cut, onAction) {
  let $cut = state.doc.resolve(cut), before = $cut.nodeBefore, after = $cut.nodeAfter, conn
  if (canJoin(state.doc, cut)) {
    if (onAction) {
      let tr = state.tr.join(cut)
      if (tr.steps.length && before.content.size == 0 && !before.sameMarkup(after) &&
          $cut.parent.canReplace($cut.index() - 1, $cut.index()))
        tr.setNodeType(cut - before.nodeSize, after.type, after.attrs)
      onAction(tr.scrollAction())
    }
    return true
  } else if (after.isTextblock && (conn = before.contentMatchAt($cut.index()).findWrapping(after.type, after.attrs))) {
    if (onAction) {
      let end = cut + after.nodeSize, wrap = Fragment.empty
      for (let i = conn.length - 1; i >= 0; i--)
        wrap = Fragment.from(conn[i].type.create(conn[i].attrs, wrap))
      wrap = Fragment.from(before.copy(wrap))
      let tr = state.tr.step(new ReplaceAroundStep(cut - 1, end, cut, end, new Slice(wrap, 1, 0), conn.length, true))
      let joinAt = end + 2 * conn.length
      if (canJoin(tr.doc, joinAt)) tr.join(joinAt)
      onAction(tr.scrollAction())
    }
    return true
  } else {
    let selAfter = Selection.findFrom($cut, 1)
    let range = selAfter.$from.blockRange(selAfter.$to), target = range && liftTarget(range)
    if (target == null) return false
    if (onAction) onAction(state.tr.lift(range, target).scrollAction())
    return true
  }
}

// Get an offset moving backward from a current offset inside a node.
function moveBackward($pos, by) {
  if (by != "char" && by != "word")
    throw new RangeError("Unknown motion unit: " + by)

  let parent = $pos.parent, offset = $pos.parentOffset

  let cat = null, counted = 0, pos = $pos.pos
  for (;;) {
    if (offset == 0) return pos
    let {offset: start, node} = parent.childBefore(offset)
    if (!node) return pos
    if (!node.isText) return cat ? pos : pos - 1

    if (by == "char") {
      for (let i = offset - start; i > 0; i--) {
        if (!isExtendingCharAt(node.text, i - 1))
          return pos - 1
        offset--
        pos--
      }
    } else if (by == "word") {
      // Work from the current position backwards through text of a singular
      // character category (e.g. "cat" of "#!*") until reaching a character in a
      // different category (i.e. the end of the word).
      for (let i = offset - start; i > 0; i--) {
        let nextCharCat = charCategory(node.text.charAt(i - 1))
        if (cat == null || counted == 1 && cat == "space") cat = nextCharCat
        else if (cat != nextCharCat) return pos
        offset--
        pos--
        counted++
      }
    }
  }
}

function moveForward($pos, by) {
  if (by != "char" && by != "word")
    throw new RangeError("Unknown motion unit: " + by)

  let parent = $pos.parent, offset = $pos.parentOffset, pos = $pos.pos

  let cat = null, counted = 0
  for (;;) {
    if (offset == parent.content.size) return pos
    let {offset: start, node} = parent.childAfter(offset)
    if (!node) return pos
    if (!node.isText) return cat ? pos : pos + 1

    if (by == "char") {
      for (let i = offset - start; i < node.text.length; i++) {
        if (!isExtendingCharAt(node.text, i + 1))
          return pos + 1
        offset++
        pos++
      }
    } else if (by == "word") {
      for (let i = offset - start; i < node.text.length; i++) {
        let nextCharCat = charCategory(node.text.charAt(i))
        if (cat == null || counted == 1 && cat == "space") cat = nextCharCat
        else if (cat != nextCharCat) return pos
        offset++
        pos++
        counted++
      }
    }
  }
}

// Parameterized commands

function joinPointBelow(state) {
  let {node, to} = state.selection
  if (node) return canJoin(state.doc, to) ? to : null
  else return joinPoint(state.doc, to, 1)
}

// :: (NodeType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Wrap the selection in a node of the given type with the given
// attributes.
function wrapIn(nodeType, attrs) {
  return function(state, onAction) {
    let {$from, $to} = state.selection
    let range = $from.blockRange($to), wrapping = range && findWrapping(range, nodeType, attrs)
    if (!wrapping) return false
    if (onAction) onAction(state.tr.wrap(range, wrapping).scrollAction())
    return true
  }
}
exports.wrapIn = wrapIn

// :: (NodeType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Returns a command that tries to set the textblock around the
// selection to the given node type with the given attributes.
function setBlockType(nodeType, attrs) {
  return function(state, onAction) {
    let {$from, $to, node} = state.selection, depth
    if (node) {
      depth = $from.depth
    } else {
      if (!$from.depth || $to.pos > $from.end()) return false
      depth = $from.depth - 1
    }
    let target = node || $from.parent
    if (!target.isTextblock || target.hasMarkup(nodeType, attrs)) return false
    let index = $from.index(depth)
    if (!$from.node(depth).canReplaceWith(index, index + 1, nodeType)) return false
    if (onAction) {
      let where = $from.before(depth + 1)
      onAction(state.tr
               .clearMarkupFor(where, nodeType, attrs)
               .setNodeType(where, nodeType, attrs)
               .scrollAction())
    }
    return true
  }
}
exports.setBlockType = setBlockType

function markApplies(doc, from, to, type) {
  let can = false
  doc.nodesBetween(from, to, node => {
    if (can) return false
    can = node.isTextblock && node.contentMatchAt(0).allowsMark(type)
  })
  return can
}

// :: (MarkType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Create a command function that toggles the given mark with the
// given attributes. Will return `false` when the current selection
// doesn't support that mark. This will remove the mark if any marks
// of that type exist in the selection, or add it otherwise. If the
// selection is empty, this applies to the [stored
// marks](#state.EditorState.storedMarks) instead of a range of the
// document.
function toggleMark(markType, attrs) {
  return function(state, onAction) {
    let {empty, from, to} = state.selection
    if (!markApplies(state.doc, from, to, markType)) return false
    if (onAction) {
      if (empty) {
        if (markType.isInSet(state.storedMarks || state.doc.marksAt(from)))
          onAction({type: "removeStoredMark", markType})
        else
          onAction({type: "addStoredMark", mark: markType.create(attrs)})
      } else {
        if (state.doc.rangeHasMark(from, to, markType))
          onAction(state.tr.removeMark(from, to, markType).scrollAction())
        else
          onAction(state.tr.addMark(from, to, markType.create(attrs)).scrollAction())
      }
    }
    return true
  }
}
exports.toggleMark = toggleMark

// :: (...[(EditorState, ?(action: Action)) → bool]) → (EditorState, ?(action: Action)) → bool
// Combine a number of command functions into a single function (which
// calls them one by one until one returns true).
function chainCommands(...commands) {
  return function(state, onAction) {
    for (let i = 0; i < commands.length; i++)
      if (commands[i](state, onAction)) return true
    return false
  }
}
exports.chainCommands = chainCommands

// :: Object
// A basic keymap containing bindings not specific to any schema.
// Binds the following keys (when multiple commands are listed, they
// are chained with [`chainCommands`](#commands.chainCommands):
//
// * **Enter** to `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`
// * **Backspace** to `deleteSelection`, `joinBackward`, `deleteCharBefore`
// * **Mod-Backspace** to `deleteSelection`, `joinBackward`, `deleteWordBefore`
// * **Delete** to `deleteSelection`, `joinForward`, `deleteCharAfter`
// * **Mod-Delete** to `deleteSelection`, `joinForward`, `deleteWordAfter`
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
let baseKeymap = {
  "Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),

  "Backspace": ios ? chainCommands(deleteSelection, joinBackward) : chainCommands(deleteSelection, joinBackward, deleteCharBefore),
  "Mod-Backspace": chainCommands(deleteSelection, joinBackward, deleteWordBefore),
  "Delete": chainCommands(deleteSelection, joinForward, deleteCharAfter),
  "Mod-Delete": chainCommands(deleteSelection, joinForward, deleteWordAfter),

  "Alt-ArrowUp": joinUp,
  "Alt-ArrowDown": joinDown,
  "Mod-BracketLeft": lift,
  "Escape": selectParentNode
}

if (mac) {
  let extra = {
    "Ctrl-KeyH": baseKeymap["Backspace"],
    "Alt-Backspace": baseKeymap["Cmd-Backspace"],
    "Ctrl-KeyD": baseKeymap["Delete"],
    "Ctrl-Alt-Backspace": baseKeymap["Cmd-Delete"],
    "Alt-Delete": baseKeymap["Cmd-Delete"],
    "Alt-KeyD": baseKeymap["Cmd-Delete"]
  }
  for (let prop in extra) baseKeymap[prop] = extra[prop]
}

exports.baseKeymap = baseKeymap
