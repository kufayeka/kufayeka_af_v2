const fn1Node = require("../nodes/fn1Node");
const fn2Node = require("../nodes/fn2Node");
const fn3Node = require("../nodes/fn3Node");

const nodeDefinitions = [
  {
    id: "fn1",
    handler: fn1Node,
  },
  {
    id: "fn2",
    handler: fn2Node,
  },
  {
    id: "fn3",
    handler: fn3Node,
  },
  {
    id: "script1",
    template: "script",
    config: {
      name: "script1",
      script: `
        const total = context.global.get("script1.total", 0) + 1;
        context.global.set("script1.total", total);
        msg.script = { total };
        helpers.log("script jalan. total:", total);
        send(msg);
      `,
    },
  },
];

const wires = [
  ["inject", "fn1"],
  ["fn1", "fn3"],
  ["fn1", "fn2"],
  ["fn3", "script1"],
];

module.exports = {
  nodeDefinitions,
  wires,
};
