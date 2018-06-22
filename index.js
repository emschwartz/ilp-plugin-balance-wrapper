const BigNumber = require('bignumber.js')
const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp-plugin-balance-wrapper')
const EventEmitter = require('events')

function defaultDataHandler () {
  throw new Error('No data handler registered')
}

function defaultMoneyHandler () {
  throw new Error('No money handler registered')
}

class PluginBalanceWrapper extends EventEmitter {
  constructor ({ plugin, settleThreshold, settleTo, maximum }) {
    this.plugin = plugin
    this.plugin.registerDataHandler(this._handleData.bind(this))
    this.plugin.registerMoneyHandler(this._handleMoney.bind(this))
    this.plugin.on('connect', () => this.emit('connect'))
    this.plugin.on('disconnect', () => this.emit('disconnect'))
    this.plugin.on('error', (err) => this.emit('error', err))

    this.moneyHandler = defaultMoneyHandler
    this.dataHandler = defaultDataHandler

    this.settleThreshold = new BigNumber(settleThreshold || 0)
    this.settleTo = new BigNumber(settleTo || 0)
    this.maximum = new BigNumber(maximum || Infinity)
    this.balance = new BigNumber(0)
  }

  static get version () {
    return 2
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

    // Check if we need to actually send money before this Prepare will be accepted
    const settleAmount = this.settleTo.minus(this.balance)
    if (settleAmount.isGreaterThan(0) && this.balance.isLessThanOrEqualTo(this.settleThreshold)) {
      debug(`sending ${settleAmount} before sending ILP Prepare for amount ${prepare.amount}`)
      try {
        await this.sendMoney(settleAmount.toString())
      } catch (err) {
        debug(`unable to send ${settleAmount}. sending the ILP Prepare packet anyway`, err)
      }
    }

    const response = await this.plugin.sendData(data)

    // Undo effect on balance if the packet is rejected
    if (response[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
      this.balance = this.balance.plus(prepare.amount)
    }

    return response
  }

  async sendMoney (amount) {
    await this.plugin.sendMoney(amount)
    this.balance = this.balance.plus(amount)
    debug(`sent ${amount}. balance is now: ${this.balance}`)
  }

  async _handleMoney (amount) {
    this.balance = this.balance.plus(amount)
    debug(`got ${amount}. balance is now: ${this.balance}`)

    return this.moneyHandler(amount)
  }

  async _handleData (data) {
    let prepare
    try {
      prepare = IlpPacket.deserializeIlpPrepare(data)
    } catch (err) {
      return this.dataHandler(data)
    }

    // Check if this prepare packet would put us over the acceptable limit
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

    const response = await this.dataHandler(data)

    // Undo effect on balance is packet is rejected
    if (response[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
      this.balance = this.balance.minus(prepare.amount)
    }

    return response
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

