module.exports = {
  input: "./src/commands.js",
  output: {format: "cjs", file: "dist/commands.js"},
  sourcemap: true,
  plugins: [require("rollup-plugin-buble")()],
  external(id) { return !/^[\.\/]/.test(id) }
}
