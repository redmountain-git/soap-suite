# soaplib/resolver.py


class RecipeResolver:

    def __init__(self, base, products, batches):

        self.base_index = {
            r["id"]: r for r in base["base_recipes"]
        }

        self.product_index = {
            r["id"]: r for r in products["product_recipes"]
        }

        self.batch_index = {
            r["id"]: r for r in batches["batch_recipes"]
        }

    def resolve_batch(self, batch_id):

        batch = self.batch_index[batch_id]
        product = self.product_index[batch["product_recipe_id"]]
        base = self.base_index[product["base_recipe_id"]]

        return {
            "batch": batch,
            "product": product,
            "base": base
        }
