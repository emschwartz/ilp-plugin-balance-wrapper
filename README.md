# Plugin Balance Wrapper
> Wrap an Interledger Ledger Plugin to extend it with simple balance logic

## Usage

```js
const { PluginBalanceWrapper } = require('ilp-plugin-balance-wrapper')
const plugin = new PluginBalanceWrapper({
  plugin: pluginToWrap,
  settleThreshold: 0,
  settleTo: 0,
  maximum: 1000
})
// Now use the plugin as normal
```

