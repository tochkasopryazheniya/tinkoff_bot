class Strategies {
    BarUpDown(close, open, prevClose, lastOperation) {
        let nClose = close.units + close.nano / 1000000000;
        let nOpen = open.units + open.nano / 1000000000;
        let nPrevClose = prevClose.units + prevClose.nano / 1000000000;

        if (nClose > nOpen && nOpen > nPrevClose && lastOperation !== "buy") {
            return "buy"
        } else if (nClose < nOpen && nOpen < nPrevClose && lastOperation !== "sell") {
            return "sell"
        } else {
            return "no"
        }
    }
}

module.exports =  new Strategies();