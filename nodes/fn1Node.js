function fn1Node(msg, send, context) {
  msg.payload = msg.payload + 1;

  const attributeData = context.global.get("attributeData") || {};
  
  console.log("fn1:", attributeData);

  send(msg);
}

module.exports = fn1Node;
