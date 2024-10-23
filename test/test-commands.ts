import {Schema, Node} from "prosemirror-model"
import {EditorState, Selection, TextSelection, NodeSelection, Command} from "prosemirror-state"
import {schema, builders, eq, doc, blockquote, pre, h1, p, li, ol, ul, em, strong, hr, img} from "prosemirror-test-builder"
import ist from "ist"

import {joinBackward, joinTextblockBackward, selectNodeBackward, joinForward, joinTextblockForward, selectNodeForward,
        deleteSelection, joinUp, joinDown, lift,
        wrapIn, splitBlock, splitBlockAs, splitBlockKeepMarks, liftEmptyBlock, createParagraphNear, setBlockType,
        selectTextblockStart, selectTextblockEnd,
        selectParentNode, autoJoin, toggleMark} from "prosemirror-commands"

function t(node: Node): {[name: string]: number} {
  return (node as any).tag
}

function selFor(doc: Node) {
  let a = t(doc).a
  if (a != null) {
    let $a = doc.resolve(a)
    if ($a.parent.inlineContent) return new TextSelection($a, t(doc).b != null ? doc.resolve(t(doc).b) : undefined)
    else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

function mkState(doc: Node) {
  return EditorState.create({doc, selection: selFor(doc)})
}

function apply(doc: Node, command: Command, result: Node | null) {
  let state = mkState(doc)
  command(state, tr => state = state.apply(tr))
  ist(state.doc, result || doc, eq)
  if (result && t(result).a != null) ist(state.selection,  selFor(result), eq)
}

describe("joinBackward", () => {
  it("can join paragraphs", () =>
     apply(doc(p("hi"), p("<a>there")), joinBackward, doc(p("hithere"))))

  it("can join out of a nested node", () =>
     apply(doc(p("hi"), blockquote(p("<a>there"))), joinBackward,
           doc(p("hi"), p("there"))))

  it("moves a block into an adjacent wrapper", () =>
     apply(doc(blockquote(p("hi")), p("<a>there")), joinBackward,
           doc(blockquote(p("hi"), p("there")))))

  it("moves a block into an adjacent wrapper from another wrapper", () =>
     apply(doc(blockquote(p("hi")), blockquote(p("<a>there"))), joinBackward,
           doc(blockquote(p("hi"), p("there")))))

  it("joins the wrapper to a subsequent one if applicable", () =>
     apply(doc(blockquote(p("hi")), p("<a>there"), blockquote(p("x"))), joinBackward,
           doc(blockquote(p("hi"), p("there"), p("x")))))

  it("moves a block into a list item", () =>
     apply(doc(ul(li(p("hi"))), p("<a>there")), joinBackward,
           doc(ul(li(p("hi")), li(p("there"))))))

  it("joins lists", () =>
     apply(doc(ul(li(p("hi"))), ul(li(p("<a>there")))), joinBackward,
           doc(ul(li(p("hi")), li(p("there"))))))

  it("joins list items", () =>
     apply(doc(ul(li(p("hi")), li(p("<a>there")))), joinBackward,
           doc(ul(li(p("hi"), p("there"))))))

  it("lifts out of a list at the start", () =>
     apply(doc(ul(li(p("<a>there")))), joinBackward, doc(p("<a>there"))))

  it("joins lists before and after", () =>
     apply(doc(ul(li(p("hi"))), p("<a>there"), ul(li(p("x")))), joinBackward,
           doc(ul(li(p("hi")), li(p("there")), li(p("x"))))))

  it("deletes leaf nodes before", () =>
     apply(doc(hr, p("<a>there")), joinBackward, doc(p("there"))))

  it("lifts before it deletes", () =>
     apply(doc(hr, blockquote(p("<a>there"))), joinBackward, doc(hr, p("there"))))

  it("does nothing at start of doc", () =>
     apply(doc(p("<a>foo")), joinBackward, null))

  it("can join single-textblock-child nodes", () => {
    let s = new Schema({
      nodes: {
        text: {inline: true},
        doc: {content: "block+"},
        block: {content: "para"},
        para: {content: "text*"}
      }
    })
    let doc = s.node("doc", null, [
      s.node("block", null, [s.node("para", null, [s.text("a")])]),
      s.node("block", null, [s.node("para", null, [s.text("b")])])
    ])
    let state = EditorState.create({doc, selection: TextSelection.near(doc.resolve(7))})
    ist(joinBackward(state, tr => state = state.apply(tr)))
    ist(state.doc.toString(), "doc(block(para(\"ab\")))")
  })

  it("doesn't return true on empty blocks that can't be deleted", () =>
    apply(doc(p("a"), ul(li(p("<a>"), ul(li("b"))))), joinBackward, null))

  it("doesn't join surrounding nodes of different types", () =>
    apply(doc(ul(li(p("a"))), p("<a>"), ol(li(p("b")))), joinBackward,
          doc(ul(li(p("a")), li(p("<a>"))), ol(li(p("b"))))))
})

describe("joinTextblockBackward", () => {
  it("can join paragraphs", () =>
     apply(doc(p("hi"), p("<a>there")), joinTextblockBackward, doc(p("hi<a>there"))))

  it("can join if second block is wrapped", () =>
     apply(doc(p("hi"), ul(li(p("<a>there")))), joinTextblockBackward, doc(p("hi<a>there"))))

  it("can join if first block is wrapped", () =>
     apply(doc(blockquote(p("hi")), p("<a>there")), joinTextblockBackward, doc(blockquote(p("hi<a>there")))))

  it("does nothing at start of doc", () =>
     apply(doc(p("<a>foo")), joinTextblockBackward, null))

  it("can join if inside a nested block", () =>
     apply(doc(blockquote(blockquote(p("hi")), p("<a>there"))),
           joinTextblockBackward,
           doc(blockquote(blockquote(p("hi<a>there"))))))
})

describe("selectNodeBackward", () => {
  it("selects the node before the cut", () =>
     apply(doc(blockquote(p("a")), blockquote(p("<a>b"))), selectNodeBackward,
           doc("<a>", blockquote(p("a")), blockquote(p("b")))))

  it("does nothing when not at the start of the textblock", () =>
     apply(doc(p("a<a>b")), selectNodeBackward, null))
})

describe("deleteSelection", () => {
  it("deletes part of a text node", () =>
     apply(doc(p("f<a>o<b>o")), deleteSelection, doc(p("fo"))))

  it("can delete across blocks", () =>
     apply(doc(p("f<a>oo"), p("ba<b>r")), deleteSelection, doc(p("fr"))))

  it("deletes node selections", () =>
     apply(doc(p("foo"), "<a>", hr()), deleteSelection, doc(p("foo"))))

  it("moves selection after deleted node", () =>
     apply(doc(p("a"), "<a>", p("b"), blockquote(p("c"))), deleteSelection,
           doc(p("a"), blockquote(p("<a>c")))))

  it("moves selection before deleted node at end", () =>
     apply(doc(p("a"), "<a>", p("b")), deleteSelection,
           doc(p("a<a>"))))
})

describe("joinForward", () => {
  it("joins two textblocks", () =>
     apply(doc(p("foo<a>"), p("bar")), joinForward, doc(p("foobar"))))

  it("keeps type of second node when first is empty", () =>
     apply(doc(p("x"), p("<a>"), h1("hi")), joinForward, doc(p("x"), h1("<a>hi"))))

  it("clears nodes from joined node that wouldn't be allowed in target node", () =>
     apply(doc(pre("foo<a>"), p("bar", img())), joinForward, doc(pre("foo<a>bar"))))

  it("does nothing at the end of the document", () =>
     apply(doc(p("foo<a>")), joinForward, null))

  it("deletes a leaf node after the current block", () =>
     apply(doc(p("foo<a>"), hr(), p("bar")), joinForward, doc(p("foo"), p("bar"))))

  it("pulls the next block into the current list item", () =>
     apply(doc(ul(li(p("a<a>")), li(p("b")))), joinForward,
           doc(ul(li(p("a"), p("b"))))))

  it("joins two blocks inside of a list item", () =>
     apply(doc(ul(li(p("a<a>"), p("b")))), joinForward,
           doc(ul(li(p("ab"))))))

  it("pulls the next block into a blockquote", () =>
     apply(doc(blockquote(p("foo<a>")), p("bar")), joinForward,
           doc(blockquote(p("foo<a>"), p("bar")))))

  it("joins two blockquotes", () =>
     apply(doc(blockquote(p("hi<a>")), blockquote(p("there"))), joinForward,
           doc(blockquote(p("hi"), p("there")))))

  it("pulls the next block outside of a wrapping blockquote", () =>
     apply(doc(p("foo<a>"), blockquote(p("bar"))), joinForward,
           doc(p("foo"), p("bar"))))

  it("joins two lists", () =>
     apply(doc(ul(li(p("hi<a>"))), ul(li(p("there")))), joinForward,
           doc(ul(li(p("hi")), li(p("there"))))))

  it("does nothing in a nested node at the end of the document", () =>
     apply(doc(ul(li(p("there<a>")))), joinForward,
           null))

  it("deletes a leaf node at the end of the document", () =>
     apply(doc(p("there<a>"), hr()), joinForward,
           doc(p("there"))))

  it("moves before it deletes a leaf node", () =>
     apply(doc(blockquote(p("there<a>")), hr()), joinForward,
           doc(blockquote(p("there"), hr()))))

  it("does nothing when it can't join", () =>
     apply(doc(p("foo<a>"), ul(li(p("bar"), ul(li(p("baz")))))), joinForward,
           null))
})

describe("joinTextblockForward", () => {
  it("can join paragraphs", () =>
     apply(doc(p("hi<a>"), p("there")), joinTextblockForward, doc(p("hi<a>there"))))

  it("can join if second block is wrapped", () =>
     apply(doc(p("hi<a>"), ul(li(p("there")))), joinTextblockForward, doc(p("hi<a>there"))))

  it("can join if first block is wrapped", () =>
     apply(doc(blockquote(p("hi<a>")), p("there")), joinTextblockForward, doc(blockquote(p("hi<a>there")))))

  it("does nothing at end of doc", () =>
     apply(doc(p("foo<a>")), joinTextblockForward, null))
})

describe("selectNodeForward", () => {
  it("selects the next node", () =>
     apply(doc(p("foo<a>"), ul(li(p("bar"), ul(li(p("baz")))))), selectNodeForward,
           doc(p("foo<a>"), "<a>", ul(li(p("bar"), ul(li(p("baz"))))))))

  it("does nothing at end of document", () =>
     apply(doc(p("foo<a>")), selectNodeForward, null))
})

describe("joinUp", () => {
  it("joins identical parent blocks", () =>
     apply(doc(blockquote(p("foo")), blockquote(p("<a>bar"))), joinUp,
           doc(blockquote(p("foo"), p("<a>bar")))))

  it("does nothing in the first block", () =>
     apply(doc(blockquote(p("<a>foo")), blockquote(p("bar"))), joinUp, null))

  it("joins lists", () =>
     apply(doc(ul(li(p("foo"))), ul(li(p("<a>bar")))), joinUp,
           doc(ul(li(p("foo")), li(p("bar"))))))

  it("joins list items", () =>
     apply(doc(ul(li(p("foo")), li(p("<a>bar")))), joinUp,
           doc(ul(li(p("foo"), p("bar"))))))

  it("doesn't look at ancestors when a block is selected", () =>
     apply(doc(ul(li(p("foo")), li("<a>", p("bar")))), joinUp, null))

  it("can join selected block nodes", () =>
     apply(doc(ul(li(p("foo")), "<a>", li(p("bar")))), joinUp,
           doc(ul("<a>", li(p("foo"), p("bar"))))))
})

describe("joinDown", () => {
  it("joins parent blocks", () =>
     apply(doc(blockquote(p("foo<a>")), blockquote(p("bar"))), joinDown,
           doc(blockquote(p("foo<a>"), p("bar")))))

  it("doesn't join with the block before", () =>
     apply(doc(blockquote(p("foo")), blockquote(p("<a>bar"))), joinDown, null))

  it("joins lists", () =>
     apply(doc(ul(li(p("foo<a>"))), ul(li(p("bar")))), joinDown,
           doc(ul(li(p("foo")), li(p("bar"))))))

  it("joins list items", () =>
     apply(doc(ul(li(p("<a>foo")), li(p("bar")))), joinDown,
           doc(ul(li(p("foo"), p("bar"))))))

  it("doesn't look at parent nodes of a selected node", () =>
     apply(doc(ul(li("<a>", p("foo")), li(p("bar")))), joinDown, null))

  it("can join selected nodes", () =>
     apply(doc(ul("<a>", li(p("foo")), li(p("bar")))), joinDown,
           doc(ul("<a>", li(p("foo"), p("bar"))))))
})

describe("lift", () => {
  it("lifts out of a parent block", () =>
     apply(doc(blockquote(p("<a>foo"))), lift, doc(p("<a>foo"))))

  it("splits the parent block when necessary", () =>
     apply(doc(blockquote(p("foo"), p("<a>bar"), p("baz"))), lift,
           doc(blockquote(p("foo")), p("bar"), blockquote(p("baz")))))

  it("can lift out of a list", () =>
     apply(doc(ul(li(p("<a>foo")))), lift, doc(p("foo"))))

  it("does nothing for a top-level block", () =>
     apply(doc(p("<a>foo")), lift, null))

  it("lifts out of the innermost parent", () =>
     apply(doc(blockquote(ul(li(p("foo<a>"))))), lift,
           doc(blockquote(p("foo<a>")))))

  it("can lift a node selection", () =>
     apply(doc(blockquote("<a>", ul(li(p("foo"))))), lift,
           doc("<a>", ul(li(p("foo"))))))

  it("lifts out of a nested list", () =>
     apply(doc(ul(li(p("one"), ul(li(p("<a>sub1")), li(p("sub2")))), li(p("two")))), lift,
           doc(ul(li(p("one"), p("<a>sub1"), ul(li(p("sub2")))), li(p("two"))))))
})

describe("wrapIn", () => {
  let wrap = wrapIn(schema.nodes.blockquote)

  it("can wrap a paragraph", () =>
     apply(doc(p("fo<a>o")), wrap, doc(blockquote(p("foo")))))

  it("wraps multiple pragraphs", () =>
     apply(doc(p("fo<a>o"), p("bar"), p("ba<b>z"), p("quux")), wrap,
           doc(blockquote(p("foo"), p("bar"), p("baz")), p("quux"))))

  it("wraps an already wrapped node", () =>
     apply(doc(blockquote(p("fo<a>o"))), wrap,
           doc(blockquote(blockquote(p("foo"))))))

  it("can wrap a node selection", () =>
     apply(doc("<a>", ul(li(p("foo")))), wrap,
           doc(blockquote(ul(li(p("foo")))))))
})

describe("splitBlock", () => {
  it("splits a paragraph at the end", () =>
     apply(doc(p("foo<a>")), splitBlock, doc(p("foo"), p())))

  it("split a pragraph in the middle", () =>
    apply(doc(p("foo<a>bar")), splitBlock, doc(p("foo"), p("bar"))))

  it("splits a paragraph from a heading", () =>
     apply(doc(h1("foo<a>")), splitBlock, doc(h1("foo"), p())))

  it("splits a heading in two when in the middle", () =>
     apply(doc(h1("foo<a>bar")), splitBlock, doc(h1("foo"), h1("bar"))))

  it("deletes selected content", () =>
     apply(doc(p("fo<a>ob<b>ar")), splitBlock, doc(p("fo"), p("ar"))))

  it("splits a parent block when a node is selected", () =>
     apply(doc(ol(li(p("a")), "<a>", li(p("b")), li(p("c")))), splitBlock,
           doc(ol(li(p("a"))), ol(li(p("b")), li(p("c"))))))

  it("doesn't split the parent block when at the start", () =>
     apply(doc(ol("<a>", li(p("a")), li(p("b")), li(p("c")))), splitBlock, null))

  it("splits off a normal paragraph when splitting at the start of a textblock", () =>
     apply(doc(h1("<a>foo")), splitBlock, doc(p(), h1("foo"))))

  const hSchema = new Schema({
    nodes: schema.spec.nodes.update("heading", {
      content: "inline*"
    }).update("doc", {
      content: "heading block*"
    }).addToEnd("span", {
      inline: true,
      group: "inline",
      content: "inline*"
    })
  })
  function hDoc(a: number) {
    const hDoc = hSchema.node("doc", null, [
      hSchema.node("heading", {level: 1}, hSchema.text("foobar"))
    ])
    ;(hDoc as any).tag = {a}
    return hDoc
  }

  it("splits a paragraph from a heading when a double heading isn't allowed", () =>
     apply(hDoc(4), splitBlock,
           hSchema.node("doc", null, [
             hSchema.node("heading", {level: 1}, hSchema.text("foo")),
             hSchema.node("paragraph", null, hSchema.text("bar"))
           ])))

  it("won't try to reset the type of an empty leftover when the schema forbids it", () =>
     apply(hDoc(1), splitBlock,
           hSchema.node("doc", null, [
             hSchema.node("heading", {level: 1}),
             hSchema.node("paragraph", null, hSchema.text("foobar"))
           ])))

  it("can split an inline node", () => {
    let d = hSchema.node("doc", null, [
      hSchema.node("heading", {level: 1}, [
        hSchema.node("span", null, hSchema.text("abcd"))])])
    ;(d as any).tag = {a: 4}
    apply(d, splitBlock, hSchema.node("doc", null, [
      hSchema.node("heading", {level: 1}, hSchema.node("span", null, hSchema.text("ab"))),
      hSchema.node("paragraph", null, hSchema.node("span", null, hSchema.text("cd")))
    ]))
  })

  it("prefers textblocks", () => {
    let s = new Schema({nodes: {
      text: {},
      para: {content: "text*", toDOM() { return ["p", 0] }},
      section: {content: "para+", toDOM() { return ["section", 0] }},
      doc: {content: "para* section*"}
    }})
    let doc = s.node("doc", null, [s.node("para", null, [s.text("hello")])])
    ;(doc as any).tag = {a: 3}
    apply(doc, splitBlock,
          s.node("doc", null, [s.node("para", null, [s.text("he")]),
                               s.node("para", null, [s.text("llo")])]))
  })
})

describe("splitBlockAs", () => {
  it("splits to the appropriate type", () =>
    apply(doc(p("on<a>e")), splitBlockAs(n => ({type: n.type.schema.nodes.heading, attrs: {level: 1}})),
          doc(p("on"), h1("<a>e"))))

  it("passes an end-of-block flag", () =>
    apply(doc(p("one<a>")),
          splitBlockAs((n, e) => e ? {type: n.type.schema.nodes.code_block} : null),
          doc(p("one"), pre("<a>"))))
})

describe("splitBlockKeepMarks", () => {
  it("keeps marks when used after marked text", () => {
    let state = mkState(doc(p(strong("foo<a>"), "bar")))
    splitBlockKeepMarks(state, tr => state = state.apply(tr))
    ist(state.storedMarks!.length, 1)
  })

  it("preserves the stored marks", () => {
    let state = mkState(doc(p(em("foo<a>"))))
    toggleMark(schema.marks.strong)(state, tr => state = state.apply(tr))
    splitBlockKeepMarks(state, tr => state = state.apply(tr))
    ist(state.storedMarks!.length, 2)
  })
})

describe("liftEmptyBlock", () => {
  it("splits the parent block when there are sibling before", () =>
     apply(doc(blockquote(p("foo"), p("<a>"), p("bar"))), liftEmptyBlock,
           doc(blockquote(p("foo")), blockquote(p(), p("bar")))))

  it("lifts the last child out of its parent", () =>
     apply(doc(blockquote(p("foo"), p("<a>"))), liftEmptyBlock,
           doc(blockquote(p("foo")), p())))

  it("lifts an only child", () =>
     apply(doc(blockquote(p("foo")), blockquote(p("<a>"))), liftEmptyBlock,
           doc(blockquote(p("foo")), p("<a>"))))

  it("does not violate schema constraints", () =>
     apply(doc(ul(li(p("<a>foo"), blockquote(p("bar"))))), liftEmptyBlock, null))

  it("lifts out of a list", () =>
     apply(doc(ul(li(p("hi")), li(p("<a>")))), liftEmptyBlock,
           doc(ul(li(p("hi"))), p())))
})

describe("createParagraphNear", () => {
  it("creates a paragraph before a selected node at the start of the doc", () =>
     apply(doc("<a>", hr(), hr()), createParagraphNear, doc(p(), hr(), hr())))

  it("creates a paragraph after a lone selected node", () =>
     apply(doc("<a>", hr()), createParagraphNear, doc(hr(), p())))

  it("creates a paragraph after selected nodes not at the start of the doc", () =>
     apply(doc(p(), "<a>", hr()), createParagraphNear, doc(p(), hr(), p())))
})

describe("setBlockType", () => {
  let setHeading = setBlockType(schema.nodes.heading, {level: 1})
  let setPara = setBlockType(schema.nodes.paragraph)
  let setCode = setBlockType(schema.nodes.code_block)

  it("can change the type of a paragraph", () =>
     apply(doc(p("fo<a>o")), setHeading, doc(h1("foo"))))

  it("can change the type of a code block", () =>
     apply(doc(pre("fo<a>o")), setHeading, doc(h1("foo"))))

  it("can make a heading into a paragraph", () =>
     apply(doc(h1("fo<a>o")), setPara, doc(p("foo"))))

  it("preserves marks", () =>
     apply(doc(h1("fo<a>o", em("bar"))), setPara, doc(p("foo", em("bar")))))

  it("acts on node selections", () =>
     apply(doc("<a>", h1("foo")), setPara, doc(p("foo"))))

  it("can make a block a code block", () =>
     apply(doc(h1("fo<a>o")), setCode, doc(pre("foo"))))

  it("clears marks when necessary", () =>
     apply(doc(p("fo<a>o", em("bar"))), setCode, doc(pre("foobar"))))

  it("acts on multiple blocks when possible", () =>
     apply(doc(p("a<a>bc"), p("def"), ul(li(p("ghi"), p("jk<b>l")))), setCode,
           doc(pre("a<a>bc"), pre("def"), ul(li(p("ghi"), pre("jk<b>l"))))))

  it("returns false when all textblocks in the selection are already this type", () =>
     apply(doc(pre("a<a>bc"), pre("de<b>f")), setCode, null))

  it("returns false when the selected blocks can't be changed", () =>
     apply(doc(ul(p("a<a>b<b>c"), p("def"))), setCode, null))
})

describe("selectParentNode", () => {
  it("selects the whole textblock", () =>
     apply(doc(ul(li(p("foo"), p("b<a>ar")), li(p("baz")))), selectParentNode,
           doc(ul(li(p("foo"), "<a>", p("bar")), li(p("baz"))))))

  it("goes one level up when on a block", () =>
     apply(doc(ul(li(p("foo"), "<a>", p("bar")), li(p("baz")))), selectParentNode,
           doc(ul("<a>", li(p("foo"), p("bar")), li(p("baz"))))))

  it("goes further up", () =>
     apply(doc(ul("<a>", li(p("foo"), p("bar")), li(p("baz")))), selectParentNode,
           doc("<a>", ul(li(p("foo"), p("bar")), li(p("baz"))))))

  it("stops at the top level", () =>
     apply(doc("<a>", ul(li(p("foo"), p("bar")), li(p("baz")))), selectParentNode,
           doc("<a>", ul(li(p("foo"), p("bar")), li(p("baz"))))))
})

describe("autoJoin", () => {
  it("joins lists when deleting a paragraph between them", () =>
     apply(doc(ul(li(p("a"))), "<a>", p("b"), ul(li(p("c")))),
           autoJoin(deleteSelection, ["bullet_list"]),
           doc(ul(li(p("a")), li(p("c"))))))

  it("doesn't join lists when deleting an item inside of them", () =>
     apply(doc(ul(li(p("a")), "<a>", li(p("b"))), ul(li(p("c")))),
           autoJoin(deleteSelection, ["bullet_list"]),
           doc(ul(li(p("a"))), ul(li(p("c"))))))

  it("joins lists when wrapping a paragraph after them in a list", () =>
     apply(doc(ul(li(p("a"))), p("b<a>")),
           autoJoin(wrapIn(schema.nodes.bullet_list), ["bullet_list"]),
           doc(ul(li(p("a")), li(p("b"))))))

  it("joins lists when wrapping a paragraph between them in a list", () =>
     apply(doc(ul(li(p("a"))), p("b<a>"), ul(li(p("c")))),
           autoJoin(wrapIn(schema.nodes.bullet_list), ["bullet_list"]),
           doc(ul(li(p("a")), li(p("b")), li(p("c"))))))

  it("joins lists when lifting a list between them", () =>
     apply(doc(ul(li(p("a"))), blockquote("<a>", ul(li(p("b")))), ul(li(p("c")))),
           autoJoin(lift, ["bullet_list"]),
           doc(ul(li(p("a")), li(p("b")), li(p("c"))))))
})

describe("toggleMark", () => {
  let toggleEm = toggleMark(schema.marks.em), toggleStrong = toggleMark(schema.marks.strong)
  let toggleEm2 = toggleMark(schema.marks.em, null, {removeWhenPresent: false})

  it("can add a mark", () => {
    apply(doc(p("one <a>two<b>")), toggleEm,
          doc(p("one ", em("two"))))
  })

  it("can stack marks", () => {
    apply(doc(p("one <a>tw", strong("o<b>"))), toggleEm,
          doc(p("one ", em("tw", strong("o")))))
  })

  it("can remove marks", () => {
    apply(doc(p(em("one <a>two<b>"))), toggleEm,
          doc(p(em("one "), "two")))
  })

  it("can toggle pending marks", () => {
    let state = mkState(doc(p("hell<a>o")))
    toggleEm(state, tr => state = state.apply(tr))
    ist(state.storedMarks!.length, 1)
    toggleStrong(state, tr => state = state.apply(tr))
    ist(state.storedMarks!.length, 2)
    toggleEm(state, tr => state = state.apply(tr))
    ist(state.storedMarks!.length, 1)
  })

  it("skips whitespace at selection ends when adding marks", () => {
    apply(doc(p("one<a> two  <b>three")), toggleEm,
          doc(p("one ", em("two"), "  three")))
  })

  it("doesn't skip whitespace-only selections", () => {
    apply(doc(p("one<a> <b>two")), toggleEm,
          doc(p("one", em(" "), "two")))
  })

  it("can add marks with remove-when-present off", () => {
    apply(doc(p("<a>", em("one"), " two<b>")), toggleEm2,
          doc(p(em("one two"))))
    apply(doc(p("<a>three<b>")), toggleEm2,
          doc(p(em("three"))))
  })

  it("can remove marks with remove-when-present off", () => {
    apply(doc(p(em("o<a>ne two<b>"))), toggleEm2,
          doc(p(em("o"), "ne two")))
  })

  it("can remove marks with trailing space when remove-when-present is off", () => {
    apply(doc(p(em("o<a>ne two"), "  <b>three")), toggleEm2,
          doc(p(em("o"), "ne two  three")))
  })

  function footnoteSchema() {
    let schema = new Schema({
      nodes: {
        text: {inline: true},
        doc: {content: "para+"},
        footnote: {content: "text*", atom: true, inline: true},
        para: {content: "(text | footnote)*"},
      },
      marks: {
        em: {}
      }
    })
    return builders(schema)
  }

  it("enters inline atoms by default", () => {
    let {doc, para, footnote, em, schema} = footnoteSchema()
    apply(doc(para("h<a>ello", footnote("okay"), "<b>")),
          toggleMark(schema.marks.em),
          doc(para("h", em("ello", footnote(em("okay"))))))
  })

  it("doesn't enter inline atoms to add a mark when told not to", () => {
    let {doc, para, footnote, em, schema} = footnoteSchema()
    apply(doc(para("h<a>ello", footnote("okay"), "<b>")),
          toggleMark(schema.marks.em, null, {enterInlineAtoms: false}),
          doc(para("h", em("ello", footnote("okay")))))
  })

  it("can apply styles inside inline atoms", () => {
    let {doc, para, footnote, em, schema} = footnoteSchema()
    apply(doc(para("hello", footnote("o<a>kay<b>"))),
          toggleMark(schema.marks.em, null, {enterInlineAtoms: false}),
          doc(para("hello", footnote("o", em("kay")))))
  })

  it("can add a mark even if already active inside an inline atom", () => {
    let {doc, para, footnote, em, schema} = footnoteSchema()
    apply(doc(para("h<a>ello", footnote(em("okay")), "<b>")),
          toggleMark(schema.marks.em, null, {enterInlineAtoms: false}),
          doc(para("h", em("ello", footnote(em("okay"))))))
  })

  it("doesn't enter inline atoms to remove a mark when told not to", () => {
    let {doc, para, footnote, em, schema} = footnoteSchema()
    apply(doc(para(em("h<a>ello", footnote(em("okay")), "<b>"))),
          toggleMark(schema.marks.em, null, {enterInlineAtoms: false}),
          doc(para(em("h"), "ello", footnote(em("okay")))))
  })
})

describe('selectTextblockStart and selectTextblockEnd', () => {
  it("can move the cursor when the selection is empty", () => {
    apply(doc(p("one <a>two")), selectTextblockStart,
          doc(p("<a>one two")))

    apply(doc(p("one <a>two")), selectTextblockEnd,
          doc(p("one two<a>")))
  })

  it("can move the cursor when the selection is not empty", () => {
    apply(doc(p("one <a>two<b>")), selectTextblockStart,
          doc(p("<a>one two")))

    apply(doc(p("one <a>two<b>")), selectTextblockEnd,
          doc(p("one two<a>")))
  })

  it("can move the cursor when the selection crosses multiple text blocks", () => {
    apply(doc(p("one <a>two"), p('three<b> four')), selectTextblockStart,
          doc(p("<a>one two"), p('three four')))

    apply(doc(p("one <a>two"), p('three<b> four')), selectTextblockEnd,
          doc(p("one two"), p('three four<a>')))
  })
})
