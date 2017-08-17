import {joinPoint, canJoin, findWrapping, liftTarget, canSplit, ReplaceAroundStep} from "prosemirror-transform"
import {Slice, Fragment} from "prosemirror-model"
import {Selection, TextSelection, NodeSelection, AllSelection} from "prosemirror-state"

// :: (EditorState, ?(tr: Transaction)) → bool
// Delete the selection, if there is one.
export function deleteSelection(state, dispatch) {
  if (state.selection.empty) return false
  if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView())
  return true
}

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// If the selection is empty and at the start of a textblock, move
// that block closer to the block before it, by lifting it out of its
// parent or, if it has no parent it doesn't share with the node
// before it, moving it into a parent of that node, or joining it with
// that. Will use the view for accurate start-of-textblock detection
// if given.
export function joinBackward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("backward", state)
                        : $cursor.parentOffset > 0))
    return false

  let $cut = findCutBefore($cursor)

  // If there is no node before this, try to lift
  if (!$cut) {
    let range = $cursor.blockRange(), target = range && liftTarget(range)
    if (target == null) return false
    if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
    return true
  }

  let before = $cut.nodeBefore
  // Apply the joining algorithm
  if (!before.type.spec.isolating && deleteBarrier(state, $cut, dispatch))
    return true

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if ($cursor.parent.content.size == 0 && NodeSelection.isSelectable(before)) {
    if (dispatch) {
      let tr = state.tr.delete($cursor.before(), $cursor.after())
      tr.setSelection(NodeSelection.create(tr.doc, $cut.pos - before.nodeSize))
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  // If the node before is an atom, delete it
  if (before.isAtom && $cut.depth == $cursor.depth - 1) {
    if (dispatch) dispatch(state.tr.delete($cut.pos - before.nodeSize, $cut.pos).scrollIntoView())
    return true
  }

  return false
}

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// When the selection is empty and at the start of a textblock, select
// the node before that textblock, if possible. This is intended to be
// bound to keys like backspace, after
// [`joinBackward`](##commands.joinBackward) or other deleting
// commands, as a fall-back behavior when the schema doesn't allow
// deletion at the selected point.
export function selectNodeBackward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("backward", state)
                        : $cursor.parentOffset > 0))
    return false

  let $cut = findCutBefore($cursor), node = $cut && $cut.nodeBefore
  if (!node || !NodeSelection.isSelectable(node)) return false
  if (dispatch)
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $cut.pos - node.nodeSize)).scrollIntoView())
  return true
}

function findCutBefore($pos) {
  if (!$pos.parent.type.spec.isolating) for (let i = $pos.depth - 1; i >= 0; i--) {
    if ($pos.index(i) > 0) return $pos.doc.resolve($pos.before(i + 1))
    if ($pos.node(i).type.spec.isolating) break
  }
  return null
}

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// If the selection is empty and the cursor is at the end of a
// textblock, move the node after it closer to the node with the
// cursor (lifting it out of parents that aren't shared, moving it
// into parents of the cursor block, or joining the two when they are
// siblings). Will use the view for accurate start-of-textblock
// detection if given.
export function joinForward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("forward", state)
                        : $cursor.parentOffset < $cursor.parent.content.size))
    return false

  let $cut = findCutAfter($cursor)

  // If there is no node after this, there's nothing to do
  if (!$cut) return false

  let after = $cut.nodeAfter
  // Try the joining algorithm
  if (deleteBarrier(state, $cut, dispatch)) return true

  // If the node above has no content and the node below is
  // selectable, delete the node above and select the one below.
  if ($cursor.parent.content.size == 0 && NodeSelection.isSelectable(after)) {
    if (dispatch) {
      let tr = state.tr.delete($cursor.before(), $cursor.after())
      tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map($cut.pos)))
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  // If the next node is an atom, delete it
  if (after.isAtom && $cut.depth == $cursor.depth - 1) {
    if (dispatch) dispatch(state.tr.delete($cut.pos, $cut.pos + after.nodeSize).scrollIntoView())
    return true
  }

  return false
}

// :: (EditorState, ?(tr: Transaction), ?EditorView) → bool
// When the selection is empty and at the end of a textblock, select
// the node coming after that textblock, if possible. This is intended
// to be bound to keys like delete, after
// [`joinForward`](##commands.joinForward) and similar deleting
// commands, to provide a fall-back behavior when the schema doesn't
// allow deletion at the selected point.
export function selectNodeForward(state, dispatch, view) {
  let {$cursor} = state.selection
  if (!$cursor || (view ? !view.endOfTextblock("forward", state)
                        : $cursor.parentOffset < $cursor.parent.content.size))
    return false

  let $cut = findCutAfter($cursor), node = $cut && $cut.nodeAfter
  if (!node || !NodeSelection.isSelectable(node)) return false
  if (dispatch)
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $cut.pos)).scrollIntoView())
  return true
}

function findCutAfter($pos) {
  if (!$pos.parent.type.spec.isolating) for (let i = $pos.depth - 1; i >= 0; i--) {
    let parent = $pos.node(i)
    if ($pos.index(i) + 1 < parent.childCount) return $pos.doc.resolve($pos.after(i + 1))
    if (parent.type.spec.isolating) break
  }
  return null
}

// :: (EditorState, ?(tr: Transaction)) → bool
// Join the selected block or, if there is a text selection, the
// closest ancestor block of the selection that can be joined, with
// the sibling above it.
export function joinUp(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// Join the selected block, or the closest ancestor of the selection
// that can be joined, with the sibling after it.
export function joinDown(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// Lift the selected block, or the closest ancestor block of the
// selection that can be lifted, out of its parent node.
export function lift(state, dispatch) {
  let {$from, $to} = state.selection
  let range = $from.blockRange($to), target = range && liftTarget(range)
  if (target == null) return false
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView())
  return true
}

// :: (EditorState, ?(tr: Transaction)) → bool
// If the selection is in a node whose type has a truthy
// [`code`](#model.NodeSpec.code) property in its spec, replace the
// selection with a newline character.
export function newlineInCode(state, dispatch) {
  let {$head, $anchor} = state.selection
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false
  if (dispatch) dispatch(state.tr.insertText("\n").scrollIntoView())
  return true
}

// :: (EditorState, ?(tr: Transaction)) → bool
// When the selection is in a node with a truthy
// [`code`](#model.NodeSpec.code) property in its spec, create a
// default block after the code block, and move the cursor there.
export function exitCode(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// If a block node is selected, create an empty paragraph before (if
// it is its parent's first child) or after it.
export function createParagraphNear(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// If the cursor is in an empty textblock that can be lifted, lift the
// block.
export function liftEmptyBlock(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// Split the parent block of the selection. If the selection is a text
// selection, also delete its content.
export function splitBlock(state, dispatch) {
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

// :: (EditorState, ?(tr: Transaction)) → bool
// Acts like [`splitBlock`](#commands.splitBlock), but without
// resetting the set of active marks at the cursor.
export function splitBlockKeepMarks(state, dispatch) {
  return splitBlock(state, dispatch && (tr => {
    let marks = state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks())
    if (marks) tr.ensureMarks(marks)
    dispatch(tr)
  }))
}

// :: (EditorState, ?(tr: Transaction)) → bool
// Move the selection to the node wrapping the current selection, if
// any. (Will not select the document node.)
export function selectParentNode(state, dispatch) {
  let {$from, to} = state.selection, pos
  let same = $from.sharedDepth(to)
  if (same == 0) return false
  pos = $from.before(same)
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
  return true
}

// :: (EditorState, ?(tr: Transaction)) → bool
// Select the whole document.
export function selectAll(state, dispatch) {
  if (dispatch) dispatch(state.tr.setSelection(new AllSelection(state.doc)))
  return true
}

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
             .clearNonMatching($pos.pos, before.type, before.contentMatchAt(before.childCount))
             .join($pos.pos)
             .scrollIntoView())
  return true
}

function deleteBarrier(state, $cut, dispatch) {
  let before = $cut.nodeBefore, after = $cut.nodeAfter, conn, match
  if (joinMaybeClear(state, $cut, dispatch)) return true

  if ($cut.parent.canReplace($cut.index(), $cut.index() + 1) &&
      (conn = (match = before.contentMatchAt(before.childCount)).findWrapping(after.type)) &&
      match.matchType(conn[0] || after.type).validEnd) {
    if (dispatch) {
      let end = $cut.pos + after.nodeSize, wrap = Fragment.empty
      for (let i = conn.length - 1; i >= 0; i--)
        wrap = Fragment.from(conn[i].create(null, wrap))
      wrap = Fragment.from(before.copy(wrap))
      let tr = state.tr.step(new ReplaceAroundStep($cut.pos - 1, end, $cut.pos, end, new Slice(wrap, 1, 0), conn.length, true))
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

// Parameterized commands

// :: (NodeType, ?Object) → (state: EditorState, dispatch: ?(tr: Transaction)) → bool
// Wrap the selection in a node of the given type with the given
// attributes.
export function wrapIn(nodeType, attrs) {
  return function(state, dispatch) {
    let {$from, $to} = state.selection
    let range = $from.blockRange($to), wrapping = range && findWrapping(range, nodeType, attrs)
    if (!wrapping) return false
    if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
    return true
  }
}

// :: (NodeType, ?Object) → (state: EditorState, dispatch: ?(tr: Transaction)) → bool
// Returns a command that tries to set the textblock around the
// selection to the given node type with the given attributes.
export function setBlockType(nodeType, attrs) {
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
               .clearNonMatching(where, nodeType)
               .setNodeType(where, nodeType, attrs)
               .scrollIntoView())
    }
    return true
  }
}

function markApplies(doc, ranges, type) {
  for (let i = 0; i < ranges.length; i++) {
    let {$from, $to} = ranges[i]
    let can = $from.depth == 0 ? doc.type.allowsMarkType(type) : false
    doc.nodesBetween($from.pos, $to.pos, node => {
      if (can) return false
      can = node.inlineContent && node.type.allowsMarkType(type)
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
export function toggleMark(markType, attrs) {
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
export function autoJoin(command, isJoinable) {
  if (Array.isArray(isJoinable)) {
    let types = isJoinable
    isJoinable = node => types.indexOf(node.type.name) > -1
  }
  return (state, dispatch) => command(state, dispatch && wrapDispatchForJoin(dispatch, isJoinable))
}

// :: (...[(EditorState, ?(tr: Transaction), ?EditorView) → bool]) → (EditorState, ?(tr: Transaction), ?EditorView) → bool
// Combine a number of command functions into a single function (which
// calls them one by one until one returns true).
export function chainCommands(...commands) {
  return function(state, dispatch, view) {
    for (let i = 0; i < commands.length; i++)
      if (commands[i](state, dispatch, view)) return true
    return false
  }
}

let backspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward)
let del = chainCommands(deleteSelection, joinForward, selectNodeForward)

// :: Object
// A basic keymap containing bindings not specific to any schema.
// Binds the following keys (when multiple commands are listed, they
// are chained with [`chainCommands`](#commands.chainCommands):
//
// * **Enter** to `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`
// * **Mod-Enter** to `exitCode`
// * **Backspace** to `deleteSelection`, `joinBackward`, `selectNodeBackward`
// * **Mod-Backspace** to `deleteSelection`, `joinBackward`, `selectNodeBackward`
// * **Delete** to `deleteSelection`, `joinForward`, `selectNodeForward`
// * **Mod-Delete** to `deleteSelection`, `joinForward`, `selectNodeForward`
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
export let baseKeymap = {
  "Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
  "Mod-Enter": exitCode,

  "Backspace": backspace,
  "Mod-Backspace": backspace,
  "Delete": del,
  "Mod-Delete": del,

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
