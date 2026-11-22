from collections import defaultdict

class Ledger:

    def __init__(self):
        self.entries = []


    def post(self, date, description, debit, credit, amount):

        self.entries.append({
            "date": date,
            "description": description,
            "debit": debit,
            "credit": credit,
            "amount": round(amount, 2)
        })


    def export(self):

        return {
            "transactions": self.entries
        }
