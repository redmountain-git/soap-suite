import pandas as pd
from tabulate import tabulate


def profit_and_loss(ledger):

    income = {}
    expenses = {}

    for acct, bal in ledger.items():

        if acct.startswith("income"):
            income[acct] = -bal

        if acct.startswith("expenses"):
            expenses[acct] = bal

    total_income = sum(income.values())
    total_exp = sum(expenses.values())

    return {
        "income": income,
        "expenses": expenses,
        "net_profit": total_income - total_exp
    }


def print_pnl(pnl):

    rows = []

    for k, v in pnl["income"].items():
        rows.append(["Income", k, v])

    for k, v in pnl["expenses"].items():
        rows.append(["Expense", k, v])

    rows.append(["", "Net Profit", pnl["net_profit"]])

    print(tabulate(rows, headers=["Type", "Account", "Amount"]))
