const {joinPoint, canJoin, findWrapping, liftTarget, canSplit, ReplaceAroundStep} = require("prosemirror-transform")
const {Slice, Fragment} = require("prosemirror-model")
const {Selection, TextSelection, NodeSelection, AllSelection} = require("prosemirror-state")

// :: (EditorState, ?(tr: Transaction)) → bool
// Delete the selection, if there is one.
function deleteSelection(state, dispatch) {
  if (state.selection.empty) return false
  if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView())
  return true
}
exports.deleteSelection = deleteSelection

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// If the selection is empty and at the start of a textblock, move
// that block closer to the block before it, by lifting it out of its
// parent or, if it has no parent it doesn't share with the node
// before it, moving it into a parent of that node, or joining it with
// that. Will use the view for accurate start-of-textblock detection
// if given.
function joinBackward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("backward", state)
                        : $cursor.parentOffset > 0))
    return false

  // Find the node before this one
  let before, cut, cutDepth
  for (let i = $cursor.depth - 1; !before && i >= 0; i--) if ($cursor.index(i) > 0) {
    cut = $cursor.before(i + 1)
    before = $cursor.node(i).child($cursor.index(i) - 1)
    cutDepth = i
  }

  // If there is no node before this, try to lift
  if (!before) {
    let range = $cursor.blockRange(), target = range && liftTarget(range)
    if (target == null) return false
    if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
    return true
  }

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if (before.isAtom && NodeSelection.isSelectable(before) && $cursor.parent.content.size == 0) {
    if (dispatch) {
      let tr = state.tr.delete(cut, cut + $cursor.parent.nodeSize)
      tr.setSelection(NodeSelection.create(tr.doc, cut - before.nodeSize))
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  // If the node doesn't allow children, delete it
  if (before.isLeaf && cutDepth == $cursor.depth - 1) {
    if (dispatch) dispatch(state.tr.delete(cut - before.nodeSize, cut).scrollIntoView())
    return true
  }

  // Apply the joining algorithm
  return deleteBarrier(state, cut, dispatch) || selectNextNode(state, cut, -1, dispatch)
}
exports.joinBackward = joinBackward

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// If the selection is empty and the cursor is at the end of a
// textblock, move the node after it closer to the node with the
// cursor (lifting it out of parents that aren't shared, moving it
// into parents of the cursor block, or joining the two when they are
// siblings). Will use the view for accurate start-of-textblock
// detection if given.
function joinForward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("forward", state)
                        : $cursor.parentOffset < $cursor.parent.content.size))
    return false

  // Find the node after this one
  let after, cut, cutDepth
  for (let i = $cursor.depth - 1; !after && i >= 0; i--) {
    let parent = $cursor.node(i)
    if ($cursor.index(i) + 1 < parent.childCount) {
      after = parent.child($cursor.index(i) + 1)
      cut = $cursor.after(i + 1)
      cutDepth = i
    }
  }

  // If there is no node after this, there's nothing to do
  if (!after) return false

  // If the node doesn't allow children, delete it
  if (after.isLeaf && cutDepth == $cursor.depth - 1) {
    if (dispatch) dispatch(state.tr.delete(cut, cut + after.nodeSize).scrollIntoView())
    return true
  }
  // Apply the joining algorithm
  return deleteBarrier(state, cut, dispatch) || selectNextNode(state, cut, 1, dispatch)
}
exports.joinForward = joinForward

// :: (EditorState, ?(tr: Transaction)) → bool
// Join the selected block or, if there is a text selection, the
// closest ancestor block of the selection that can be joined, with
// the sibling above it.
function joinUp(state, dispatch) {
  let sel = state.selection, nodeSel = sel instanceof NodeSelection, point
  if (nodeSel) {
    if (sel.node.isTextblock || !canJoin(state.doc, sel.from)) return false
    point = sel.from
  } else {
    point = joinPoint(state.doc, sel.from, -1)
    if (point == null) return false
  }
  if (dispatch) {
    let tr = state.tr.join(point)
    if (nodeSel) tr.setSelection(NodeSelection.create(tr.doc, point - state.doc.resolve(point).nodeBefore.nodeSize))
    dispatch(tr.scrollIntoView())
  }
  return true
}
exports.joinUp = joinUp

// :: (EditorState, ?(tr: Transaction)) → bool
// Join the selected block, or the closest ancestor of the selection
// that can be joined, with the sibling after it.
function joinDown(state, dispatch) {
  let sel = state.selection, point
  if (sel instanceof NodeSelection) {
    if (sel.node.isTextblock || !canJoin(state.doc, sel.to)) return false
    point = sel.to
  } else {
    point = joinPoint(state.doc, sel.to, 1)
    if (point == null) return false
  }
  if (dispatch)
    dispatch(state.tr.join(point).scrollIntoView())
  return true
}
exports.joinDown = joinDown

// :: (EditorState, ?(tr: Transaction)) → bool
// Lift the selected block, or the closest ancestor block of the
// selection that can be lifted, out of its parent node.
function lift(state, dispatch) {
  let {$from, $to} = state.selection
  let range = $from.blockRange($to), target = range && liftTarget(range)
  if (target == null) return false
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
  return true
}
exports.lift = lift

// :: (EditorState, ?(tr: Transaction)) → bool
// If the selection is in a node whose type has a truthy
// [`code`](#model.NodeSpec.code) property in its spec, replace the
// selection with a newline character.
function newlineInCode(state, dispatch) {
  let {$head, $anchor} = state.selection
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false
  if (dispatch) dispatch(state.tr.insertText("\n").scrollIntoView())
  return true
}
exports.newlineInCode = newlineInCode

// :: (EditorState, ?(tr: Transaction)) → bool
// When the selection is in a node with a truthy
// [`code`](#model.NodeSpec.code) property in its spec, create a
// default block after the code block, and move the cursor there.
function exitCode(state, dispatch) {
  let {$head, $anchor} = state.selection
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false
  let above = $head.node(-1), after = $head.indexAfter(-1), type = above.defaultContentType(after)
  if (!above.canReplaceWith(after, after, type)) return false
  if (dispatch) {
    let pos = $head.after(), tr = state.tr.replaceWith(pos, pos, type.createAndFill())
    tr.setSelection(Selection.near(tr.doc.resolve(pos), 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}
exports.exitCode = exitCode

// :: (EditorState, ?(tr: Transaction)) → bool
// If a block node is selected, create an empty paragraph before (if
// it is its parent's first child) or after it.
function createParagraphNear(state, dispatch) {
  let {$from, $to} = state.selection
  if ($from.parent.inlineContent || $to.parent.inlineContent) return false
  let type = $from.parent.defaultContentType($to.indexAfter())
  if (!type || !type.isTextblock) return false
  if (dispatch) {
    let side = (!$from.parentOffset && $to.index() < $to.parent.childCount ? $from : $to).pos
    let tr = state.tr.insert(side, type.createAndFill())
    tr.setSelection(TextSelection.create(tr.doc, side + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}
exports.createParagraphNear = createParagraphNear

// :: (EditorState, ?(tr: Transaction)) → bool
// If the cursor is in an empty textblock that can be lifted, lift the
// block.
function liftEmptyBlock(state, dispatch) {
  let {$cursor} = state.selection
  if (!$cursor || $cursor.parent.content.size) return false
  if ($cursor.depth > 1 && $cursor.after() != $cursor.end(-1)) {
    let before = $cursor.before()
    if (canSplit(state.doc, before)) {
      if (dispatch) dispatch(state.tr.split(before).scrollIntoView())
      return true
    }
  }
  let range = $cursor.blockRange(), target = range && liftTarget(range)
  if (target == null) return false
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
  return true
}
exports.liftEmptyBlock = liftEmptyBlock

// :: (EditorState, ?(tr: Transaction)) → bool
// Split the parent block of the selection. If the selection is a text
// selection, also delete its content.
function splitBlock(state, dispatch) {
  let {$from, $to} = state.selection
  if (state.selection instanceof NodeSelection && state.selection.node.isBlock) {
    if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false
    if (dispatch) dispatch(state.tr.split($from.pos).scrollIntoView())
    return true
  }

  if (dispatch) {
    let atEnd = $to.parentOffset == $to.parent.content.size
    let tr = state.tr
    if (state.selection instanceof TextSelection) tr.deleteSelection()
    let deflt = $from.depth == 0 ? null : $from.node(-1).defaultContentType($from.indexAfter(-1))
    let types = atEnd ? [{type: deflt}] : null
    let can = canSplit(tr.doc, $from.pos, 1, types)
    if (!types && !can && canSplit(tr.doc, tr.mapping.map($from.pos), 1, [{type: deflt}])) {
      types = [{type: deflt}]
      can = true
    }
    if (can) {
      tr.split(tr.mapping.map($from.pos), 1, types)
      if (!atEnd && !$from.parentOffset && $from.parent.type != deflt &&
          $from.node(-1).canReplace($from.index(-1), $from.indexAfter(-1), Fragment.from(deflt.create(), $from.parent)))
        tr.setNodeType(tr.mapping.map($from.before()), deflt)
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}
exports.splitBlock = splitBlock

// :: (EditorState, ?(tr: Transaction)) → bool
// Acts like [`splitBlock`](#commands.splitBlock), but without
// resetting the set of active marks at the cursor.
function splitBlockKeepMarks(state, dispatch) {
  return splitBlock(state, dispatch && (tr => {
    let marks = state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks())
    if (marks) tr.ensureMarks(marks)
    dispatch(tr)
  }))
}
exports.splitBlockKeepMarks = splitBlockKeepMarks

// :: (EditorState, ?(tr: Transaction)) → bool
// Move the selection to the node wrapping the current selection, if
// any. (Will not select the document node.)
function selectParentNode(state, dispatch) {
  let {$from, to} = state.selection, pos
  let same = $from.sharedDepth(to)
  if (same == 0) return false
  pos = $from.before(same)
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
  return true
}
exports.selectParentNode = selectParentNode

// :: (EditorState, ?(tr: Transaction)) → bool
// Select the whole document.
function selectAll(state, dispatch) {
  if (dispatch) dispatch(state.tr.setSelection(new AllSelection(state.doc)))
  return true
}
exports.selectAll = selectAll

function joinMaybeClear(state, $pos, dispatch) {
  let before = $pos.nodeBefore, after = $pos.nodeAfter, index = $pos.index()
  if (!before || !after || !before.type.compatibleContent(after.type)) return false
  if (!before.content.size && $pos.parent.canReplace(index - 1, index)) {
    if (dispatch) dispatch(state.tr.delete($pos.pos - before.nodeSize, $pos.pos).scrollIntoView())
    return true
  }
  if (!$pos.parent.canReplace(index, index + 1) || !(after.isTextblock || canJoin(state.doc, $pos.pos)))
    return false
  if (dispatch)
    dispatch(state.tr
             .clearNonMatching($pos.pos, before.contentMatchAt(before.childCount))
             .join($pos.pos)
             .scrollIntoView())
  return true
}

function deleteBarrier(state, cut, dispatch) {
  let $cut = state.doc.resolve(cut), before = $cut.nodeBefore, after = $cut.nodeAfter, conn, match
  if (joinMaybeClear(state, $cut, dispatch)) return true

  if ($cut.parent.canReplace($cut.index(), $cut.index() + 1) &&
      (conn = (match = before.contentMatchAt(before.childCount)).findWrappingFor(after))&&
      match.matchType((conn[0] || after).type, (conn[0] || after).attrs).validEnd()) {
    if (dispatch) {
      let end = cut + after.nodeSize, wrap = Fragment.empty
      for (let i = conn.length - 1; i >= 0; i--)
        wrap = Fragment.from(conn[i].type.create(conn[i].attrs, wrap))
      wrap = Fragment.from(before.copy(wrap))
      let tr = state.tr.step(new ReplaceAroundStep(cut - 1, end, cut, end, new Slice(wrap, 1, 0), conn.length, true))
      let joinAt = end + 2 * conn.length
      if (canJoin(tr.doc, joinAt)) tr.join(joinAt)
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  let selAfter = Selection.findFrom($cut, 1)
  let range = selAfter && selAfter.$from.blockRange(selAfter.$to), target = range && liftTarget(range)
  if (target != null && target >= $cut.depth) {
    if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
    return true
  }

  return false
}

function selectNextNode(state, cut, dir, dispatch) {
  let $cut = state.doc.resolve(cut)
  let node = dir > 0 ? $cut.nodeAfter : $cut.nodeBefore
  if (!node || !NodeSelection.isSelectable(node)) return false
  if (dispatch)
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, cut - (dir > 0 ? 0 : node.nodeSize))).scrollIntoView())
  return true
}

// Parameterized commands

// :: (NodeType, ?Object) → (state: EditorState, dispatch: ?(tr: Transaction)) → bool
// Wrap the selection in a node of the given type with the given
// attributes.
function wrapIn(nodeType, attrs) {
  return function(state, dispatch) {
    let {$from, $to} = state.selection
    let range = $from.blockRange($to), wrapping = range && findWrapping(range, nodeType, attrs)
    if (!wrapping) return false
    if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
    return true
  }
}
exports.wrapIn = wrapIn

// :: (NodeType, ?Object) → (state: EditorState, dispatch: ?(tr: Transaction)) → bool
// Returns a command that tries to set the textblock around the
// selection to the given node type with the given attributes.
function setBlockType(nodeType, attrs) {
  return function(state, dispatch) {
    let {$from, $to} = state.selection, depth, target
    if (state.selection instanceof NodeSelection) {
      depth = $from.depth
      target = state.selection.node
    } else {
      if (!$from.depth || $to.pos > $from.end()) return false
      depth = $from.depth - 1
      target = $from.parent
    }
    if (!target.isTextblock || target.hasMarkup(nodeType, attrs)) return false
    let index = $from.index(depth)
    if (!$from.node(depth).canReplaceWith(index, index + 1, nodeType)) return false
    if (dispatch) {
      let where = $from.before(depth + 1)
      dispatch(state.tr
               .clearNonMatching(where, nodeType.contentExpr.start(attrs))
               .setNodeType(where, nodeType, attrs)
               .scrollIntoView())
    }
    return true
  }
}
exports.setBlockType = setBlockType

function markApplies(doc, ranges, type) {
  for (let i = 0; i < ranges.length; i++) {
    let {$from, $to} = ranges[i]
    let can = $from.depth == 0 ? doc.contentMatchAt(0).allowsMark(type) : false
    doc.nodesBetween($from.pos, $to.pos, node => {
      if (can) return false
      can = node.inlineContent && node.contentMatchAt(0).allowsMark(type)
    })
    if (can) return true
  }
  return false
}

// :: (MarkType, ?Object) → (state: EditorState, dispatch: ?(tr: Transaction)) → bool
// Create a command function that toggles the given mark with the
// given attributes. Will return `false` when the current selection
// doesn't support that mark. This will remove the mark if any marks
// of that type exist in the selection, or add it otherwise. If the
// selection is empty, this applies to the [stored
// marks](#state.EditorState.storedMarks) instead of a range of the
// document.
function toggleMark(markType, attrs) {
  return function(state, dispatch) {
    let {empty, $cursor, ranges} = state.selection
    if ((empty && !$cursor) || !markApplies(state.doc, ranges, markType)) return false
    if (dispatch) {
      if ($cursor) {
        if (markType.isInSet(state.storedMarks || $cursor.marks()))
          dispatch(state.tr.removeStoredMark(markType))
        else
          dispatch(state.tr.addStoredMark(markType.create(attrs)))
      } else {
        let has = false, tr = state.tr
        for (let i = 0; !has && i < ranges.length; i++) {
          let {$from, $to} = ranges[i]
          has = state.doc.rangeHasMark($from.pos, $to.pos, markType)
        }
        for (let i = 0; i < ranges.length; i++) {
          let {$from, $to} = ranges[i]
          if (has) tr.removeMark($from.pos, $to.pos, markType)
          else tr.addMark($from.pos, $to.pos, markType.create(attrs))
        }
        dispatch(tr.scrollIntoView())
      }
    }
    return true
  }
}
exports.toggleMark = toggleMark

function wrapDispatchForJoin(dispatch, isJoinable) {
  return tr => {
    if (!tr.isGeneric) return dispatch(tr)

    let ranges = []
    for (let i = 0; i < tr.mapping.maps.length; i++) {
      let map = tr.mapping.maps[i]
      for (let j = 0; j < ranges.length; j++)
        ranges[j] = map.map(ranges[j])
      map.forEach((_s, _e, from, to) => ranges.push(from, to))
    }

    // Figure out which joinable points exist inside those ranges,
    // by checking all node boundaries in their parent nodes.
    let joinable = []
    for (let i = 0; i < ranges.length; i += 2) {
      let from = ranges[i], to = ranges[i + 1]
      let $from = tr.doc.resolve(from), depth = $from.sharedDepth(to), parent = $from.node(depth)
      for (let index = $from.indexAfter(depth), pos = $from.after(depth + 1); pos <= to; ++index) {
        let after = parent.maybeChild(index)
        if (!after) break
        if (index && joinable.indexOf(pos) == -1) {
          let before = parent.child(index - 1)
          if (before.type == after.type && isJoinable(before, after))
            joinable.push(pos)
        }
        pos += after.nodeSize
      }
    }
    // Join the joinable points
    joinable.sort((a, b) => a - b)
    for (let i = joinable.length - 1; i >= 0; i--) {
      if (canJoin(tr.doc, joinable[i])) tr.join(joinable[i])
    }
    dispatch(tr)
  }
}

// :: ((state: EditorState, ?(tr: Transaction)) → bool, union<(before: Node, after: Node) → bool, [string]>) → (state: EditorState, ?(tr: Transaction)) → bool
// Wrap a command so that, when it produces a transform that causes
// two joinable nodes to end up next to each other, those are joined.
// Nodes are considered joinable when they are of the same type and
// when the `isJoinable` predicate returns true for them or, if an
// array of strings was passed, if their node type name is in that
// array.
function autoJoin(command, isJoinable) {
  if (Array.isArray(isJoinable)) {
    let types = isJoinable
    isJoinable = node => types.indexOf(node.type.name) > -1
  }
  return (state, dispatch) => command(state, dispatch && wrapDispatchForJoin(dispatch, isJoinable))
}
exports.autoJoin = autoJoin

// :: (...[(EditorState, ?(tr: Transaction)) → bool]) → (EditorState, ?(tr: Transaction)) → bool
// Combine a number of command functions into a single function (which
// calls them one by one until one returns true).
function chainCommands(...commands) {
  return function(state, dispatch, view) {
    for (let i = 0; i < commands.length; i++)
      if (commands[i](state, dispatch, view)) return true
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
// * **Mod-Enter** to `exitCode`
// * **Backspace** to `deleteSelection`, `joinBackward`
// * **Mod-Backspace** to `deleteSelection`, `joinBackward`
// * **Delete** to `deleteSelection`, `joinForward`
// * **Mod-Delete** to `deleteSelection`, `joinForward`
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
let baseKeymap = {
  "Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
  "Mod-Enter": exitCode,

  "Backspace": chainCommands(deleteSelection, joinBackward),
  "Mod-Backspace": chainCommands(deleteSelection, joinBackward),
  "Delete": chainCommands(deleteSelection, joinForward),
  "Mod-Delete": chainCommands(deleteSelection, joinForward),

  "Alt-ArrowUp": joinUp,
  "Alt-ArrowDown": joinDown,
  "Mod-BracketLeft": lift,
  "Escape": selectParentNode,
  "Mod-a": selectAll
}

// declare global: os, navigator
const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform)
          : typeof os != "undefined" ? os.platform() == "darwin" : false

if (mac) {
  let extra = {
    "Ctrl-h": baseKeymap["Backspace"],
    "Alt-Backspace": baseKeymap["Mod-Backspace"],
    "Ctrl-d": baseKeymap["Delete"],
    "Ctrl-Alt-Backspace": baseKeymap["Mod-Delete"],
    "Alt-Delete": baseKeymap["Mod-Delete"],
    "Alt-d": baseKeymap["Mod-Delete"]
  }
  for (let prop in extra) baseKeymap[prop] = extra[prop]
}

exports.baseKeymap = baseKeymap
