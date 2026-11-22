def validate_transactions(transactions):

    errors = []

    for tx in transactions["transactions"]:

        debit = 0
        credit = 0

        for line in tx["lines"]:
            debit += line["debit"]
            credit += line["credit"]

        if round(debit, 2) != round(credit, 2):

            errors.append(
                f"{tx['id']} not balanced: {debit} != {credit}"
            )

    return errors
