function fn3Node(msg, send, context) {
  const countKey = "fn3.seenCount";
  const nextCount = context.global.get(countKey, 0) + 1;
  context.global.set(countKey, nextCount);

  console.log("fn3 ini payload:", msg.payload, "| total seen:", nextCount);

  send(msg);
}

module.exports = fn3Node;
