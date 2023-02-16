const express = require('express');
const app = express();
const http = require('http');
const {SubscriptionInterval} = require("tinkoff-invest-api/cjs/generated/marketdata");
const server = http.createServer(app);
const {TinkoffInvestApi, Helpers} = require('tinkoff-invest-api');
const Stratagies = require("./Stratagies/Stratagies");
const {OrderType, OrderDirection} = require("tinkoff-invest-api/cjs/generated/orders");

require('dotenv').config();

const api = new TinkoffInvestApi({token: process.env.TOKEN});

let accountID;
let orderState = '';
let globalOrderID = '';


async function getUserInfo() {
    const {accounts} = await api.users.getAccounts({});
    accountID = accounts[0].id;
}

function covertDirection(direction) {
    switch(direction) {
        case 1:
            return 'Покупка'
        case 2:
            return 'Продажа'
    }
}
function covertOrderState(state) {
    switch(state) {
        case 0:
            return 'Хуйня какая-то произошла'
        case 1:
            return 'Исполнена'
        case 2:
            return 'Отклонена'
        case 3:
            return 'Отмена пользователем'
        case 4:
            return 'Новая'
        case 5:
            return 'Частично исполнена'
    }
}

async function checkOrderState() {
    const res = await api.orders.getOrderState({accountId: accountID, orderId: globalOrderID});
    orderState = covertOrderState(res.executionReportStatus);
    console.log(orderState);
}



async function buySellInstr(direction, figi, nano, units, quantity) {
    const price = Helpers.toQuotation(units + nano / 1000000000);
    const orderID = `ord_${Date.now()}`

    let res = await api.orders.postOrder({
        figi: figi,
        quantity: quantity,
        price: price,
        direction: direction,
        accountId: accountID,
        orderType: OrderType.ORDER_TYPE_LIMIT,
        orderId: orderID
    });
    globalOrderID = res.orderId;
    orderState = covertOrderState(res.executionReportStatus);
    console.log(`Глобальный id от ответа: ${globalOrderID}, локальный id: ${orderID}`);
    console.log(`Направление: ${covertDirection(direction)};   Цена: ${JSON.stringify(price)}`);
    return res;
}

function getAveragePrice(averagePricesArr, curPrice) {
    averagePricesArr.push(curPrice);
    const sum = averagePricesArr.reduce((acum, value) => {
        return acum + value;
    }, 0)
    return sum / averagePricesArr.length;
}



async function main() {
    await getUserInfo();

    let allCandles = [];
    let msgCount = 0;
    let indexOfArrOFCandles = -1;
    let lastOperation = 'sell';
    let lastNano;
    let lastUnit;
    let amountOfLots = 0;
    let averagePricesArr = [];
    let averagePrice = 0;
    let curInstrument = process.env.SBER;

    const unsubscribe = await api.stream.market.candles({
        instruments: [
            {figi: curInstrument, interval: SubscriptionInterval.SUBSCRIPTION_INTERVAL_ONE_MINUTE}
        ],
        waitingClose: false,
    }, async (candle) => {
        ++msgCount;
        allCandles.push(candle);
        indexOfArrOFCandles += 1;
        let curOperation;
        if (orderState) {
            await checkOrderState();
            if(orderState !== 'Исполнена') {
                return
            } else {
                orderState = '';
            }
        }
        if (msgCount > 3) {

            curOperation = Stratagies.BarUpDown(allCandles[indexOfArrOFCandles - 1].close, allCandles[indexOfArrOFCandles].open, allCandles[indexOfArrOFCandles - 2].close, lastOperation);
            let curPrice = candle.close.units + candle.close.nano / 1000000000;
            let lastPrice = lastUnit + lastNano / 1000000000;
            if (averagePrice * 1.002 < curPrice && amountOfLots > 0) {
                await buySellInstr(OrderDirection.ORDER_DIRECTION_SELL, curInstrument, candle.close.nano, candle.close.units, amountOfLots);
                amountOfLots = 0;
                lastOperation = 'sell';
                averagePrice = 0;
                averagePricesArr = [];
                return;
            } else if(curPrice < averagePrice * 0.999 && amountOfLots > 0) {
                await buySellInstr(OrderDirection.ORDER_DIRECTION_BUY, curInstrument, candle.close.nano, candle.close.units, 1);
                averagePrice = getAveragePrice(averagePricesArr, curPrice);
                amountOfLots += 1;
                lastOperation = 'buy';
                return;
            }
            console.log(`Текущая цена: ${curPrice}; Цена последней покупки: ${averagePrice}`)
            switch (curOperation) {
                case "buy":
                    if (lastOperation === 'buy') break;
                    await buySellInstr(OrderDirection.ORDER_DIRECTION_BUY, curInstrument, candle.close.nano, candle.close.units, 1);

                    averagePrice = getAveragePrice(averagePricesArr, curPrice);
                    lastNano = candle.close.nano;
                    lastUnit = candle.close.units;
                    lastOperation = curOperation;
                    amountOfLots += 1;
                    break;
                case "sell":
                    if (lastOperation === 'sell') break;
                    if (averagePrice * 1.0008 >= curPrice) break;
                    await buySellInstr(OrderDirection.ORDER_DIRECTION_SELL, curInstrument, candle.close.nano, candle.close.units, amountOfLots);
                    lastOperation = curOperation;
                    amountOfLots = 0;
                    averagePrice = 0;
                    averagePricesArr = [];
                    break;
            }
        }
    });


}

main()


server.listen(9000, () => {
    console.log('listening on *:9000');
});

