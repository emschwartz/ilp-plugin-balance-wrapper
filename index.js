const BigNumber = require('bignumber.js')
const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp-plugin-balance-wrapper')

function defaultDataHandler () {
  throw new Error('No data handler registered')
}

function defaultMoneyHandler () {
  throw new Error('No money handler registered')
}

class PluginBalanceWrapper {
  constructor ({ plugin, settleThreshold, settleTo, maximum }) {
    this.plugin = plugin
    this.plugin.registerDataHandler(this._handleData.bind(this))
    this.plugin.registerMoneyHandler(this._handleMoney.bind(this))

    this.moneyHandler = defaultMoneyHandler
    this.dataHandler = defaultDataHandler

    this.settleThreshold = new BigNumber(settleThreshold || 0)
    this.settleTo = new BigNumber(settleTo || 0)
    this.maximum = new BigNumber(maximum || Infinity)
    this.balance = new BigNumber(0)
  }

  async connect () {
    return this.plugin.connect()
  }

  async disconnect () {
    return this.plugin.disconnect()
  }

  isConnected () {
    return this.plugin.isConnected()
  }

  async sendData (data) {
    let prepare
    try {
      prepare = IlpPacket.deserializeIlpPrepare(data)
    } catch (err) {
      return this.plugin.sendData(data)
    }

    this.balance = this.balance.minus(prepare.amount)

    if (this.balance.isLessThanOrEqualTo(this.settleThreshold)) {
      const settleAmount = this.settleTo.minus(this.balance)
      debug(`sending ${settleAmount} before sending ILP Prepare for amount ${prepare.amount}`)
      await this.sendMoney()
    }
    return this.plugin.sendData(data)
  }

  async sendMoney (amount) {
    await this.plugin.sendMoney(amount)
    this.balance = this.balance.plus(amount)
  }

  async _handleMoney (amount) {
    this.balance = this.balance.plus(amount)

    return this.moneyHandler(amount)
  }

  async _handleData (data) {
    let prepare
    try {
      prepare = IlpPacket.deserializeIlpPrepare(data)
    } catch (err) {
      return this.dataHandler(data)
    }

    if (this.balance.plus(prepare.amount).isGreaterThan(this.maximum)) {
      debug(`insufficient balance to handle packet of amount ${prepare.amount}, rejecting with a T04 error. current balance: ${this.balance}, maximum: ${this.maximum}`)
      return IlpPacket.serializeIlpReject({
        code: 'T04',
        message: `Insufficient balance. Current balance: ${this.balance}, maximum: ${this.maximum}, packet amount: ${prepare.amount}`,
        data: Buffer.alloc(0),
        // TODO use ILDCP to get our address
        triggeredBy: ''
      })
    }

    return this.dataHandler(data)
  }

  registerDataHandler (handler) {
    this.dataHandler = handler
  }

  registerMoneyHandler (handler) {
    this.moneyHandler = handler
  }

  deregisterDataHandler () {
    this.dataHandler = defaultDataHandler
  }

  deregisterMoneyHandler () {
    this.moneyHandler = defaultMoneyHandler
  }
}

exports.PluginBalanceWrapper = PluginBalanceWrapper
exports.default = PluginBalanceWrapper