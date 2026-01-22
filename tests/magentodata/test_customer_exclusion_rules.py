"""
Tests for customer exclusion rule dominance logic.
Tests the rule application without requiring database connection.
"""
import pytest


def build_customer_rules(rules_list):
    """
    Build the excluded_customer_rules structure from a list of rule tuples.
    Each tuple: (email, rule_type, divisor, product_sku)
    Returns: { email: { 'base_rule': {...} or None, 'product_rules': { sku: {...} } } }
    """
    excluded_customer_rules = {}
    for email, rule_type, divisor, product_sku in rules_list:
        if email not in excluded_customer_rules:
            excluded_customer_rules[email] = {'base_rule': None, 'product_rules': {}}
        
        if rule_type in ('exclude_all', 'divide_all'):
            excluded_customer_rules[email]['base_rule'] = {
                'rule_type': rule_type,
                'divisor': float(divisor) if divisor else 2.0
            }
        elif rule_type == 'divide_product' and product_sku:
            excluded_customer_rules[email]['product_rules'][product_sku] = {
                'divisor': float(divisor) if divisor else 2.0
            }
    
    return excluded_customer_rules


def apply_exclusion_rules(customer_email, sku, qty, excluded_customer_rules):
    """
    Apply exclusion rules to a single order item.
    Returns (should_include, adjusted_qty)
    """
    if customer_email not in excluded_customer_rules:
        return True, qty
    
    rules = excluded_customer_rules[customer_email]
    base_rule = rules.get('base_rule')
    product_rules = rules.get('product_rules', {})
    
    qty_to_use = qty
    
    # Check if this product has a specific rule (takes precedence)
    if sku in product_rules:
        # Product-specific rule overrides base rule
        divisor = product_rules[sku]['divisor']
        if divisor and divisor > 0:
            qty_to_use = qty_to_use / divisor
        return True, qty_to_use
    elif base_rule:
        # Apply base rule (no product-specific override)
        if base_rule['rule_type'] == 'exclude_all':
            # Skip this product (not in product_rules, so excluded)
            return False, 0
        elif base_rule['rule_type'] == 'divide_all':
            # Divide by base divisor (no product-specific override)
            divisor = base_rule['divisor']
            if divisor and divisor > 0:
                qty_to_use = qty_to_use / divisor
            return True, qty_to_use
    
    # No rules apply, use original qty
    return True, qty


class TestExcludeAllRule:
    """Tests for exclude_all base rule"""
    
    def test_exclude_all_skips_product(self):
        """exclude_all should skip all products from customer"""
        rules = build_customer_rules([
            ('test@example.com', 'exclude_all', 2, None)
        ])
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is False
        assert qty == 0
    
    def test_exclude_all_with_product_override(self):
        """exclude_all + divide_product: product rule takes precedence"""
        rules = build_customer_rules([
            ('test@example.com', 'exclude_all', 2, None),
            ('test@example.com', 'divide_product', 2, 'SKU-123'),
        ])
        
        # Product with rule should be divided, not excluded
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2
        
        # Product without rule should still be excluded
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-OTHER', 10, rules)
        assert include is False
        assert qty == 0
    
    def test_exclude_all_with_multiple_product_overrides(self):
        """exclude_all + multiple divide_product rules"""
        rules = build_customer_rules([
            ('test@example.com', 'exclude_all', 2, None),
            ('test@example.com', 'divide_product', 2, 'SKU-A'),
            ('test@example.com', 'divide_product', 4, 'SKU-B'),
            ('test@example.com', 'divide_product', 3, 'SKU-C'),
        ])
        
        # Each product with rule gets its own divisor
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-A', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-B', 12, rules)
        assert include is True
        assert qty == 3.0  # 12 / 4
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-C', 9, rules)
        assert include is True
        assert qty == 3.0  # 9 / 3
        
        # Products without rules are excluded
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-X', 10, rules)
        assert include is False


class TestDivideAllRule:
    """Tests for divide_all base rule"""
    
    def test_divide_all_divides_product(self):
        """divide_all should divide all products from customer"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_all', 2, None)
        ])
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2
    
    def test_divide_all_with_product_override(self):
        """divide_all + divide_product: product rule takes precedence"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_all', 2, None),
            ('test@example.com', 'divide_product', 4, 'SKU-123'),
        ])
        
        # Product with specific rule uses its own divisor
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 12, rules)
        assert include is True
        assert qty == 3.0  # 12 / 4 (not 12 / 2)
        
        # Product without rule uses base divisor
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-OTHER', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2
    
    def test_divide_all_with_multiple_product_overrides(self):
        """divide_all + multiple divide_product rules"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_all', 2, None),
            ('test@example.com', 'divide_product', 5, 'SKU-A'),
            ('test@example.com', 'divide_product', 10, 'SKU-B'),
        ])
        
        # Each product with rule gets its own divisor
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-A', 20, rules)
        assert include is True
        assert qty == 4.0  # 20 / 5
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-B', 30, rules)
        assert include is True
        assert qty == 3.0  # 30 / 10
        
        # Other products use base divisor
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-X', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2


class TestDivideProductOnly:
    """Tests for divide_product rules without base rule"""
    
    def test_divide_product_only_affects_matching_sku(self):
        """divide_product without base rule only affects that product"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_product', 2, 'SKU-123'),
        ])
        
        # Matching product is divided
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 5.0
        
        # Non-matching product is not affected
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-OTHER', 10, rules)
        assert include is True
        assert qty == 10  # Original qty unchanged
    
    def test_multiple_divide_products_only(self):
        """Multiple divide_product rules without base rule"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_product', 2, 'SKU-A'),
            ('test@example.com', 'divide_product', 3, 'SKU-B'),
        ])
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-A', 10, rules)
        assert qty == 5.0
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-B', 9, rules)
        assert qty == 3.0
        
        # Non-matching product unchanged
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-X', 10, rules)
        assert qty == 10


class TestNoRules:
    """Tests for customers without rules"""
    
    def test_no_rules_customer(self):
        """Customer not in rules should not be affected"""
        rules = build_customer_rules([
            ('other@example.com', 'exclude_all', 2, None),
        ])
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 10


class TestEdgeCases:
    """Edge case tests"""
    
    def test_zero_divisor_defaults_to_two(self):
        """Divisor of 0 or None defaults to 2.0"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_all', 0, None),
        ])
        
        # Divisor 0 is falsy, so defaults to 2.0
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 5.0  # 10 / 2 (default divisor)
    
    def test_fractional_divisor(self):
        """Fractional divisors should work"""
        rules = build_customer_rules([
            ('test@example.com', 'divide_all', 0.5, None),
        ])
        
        include, qty = apply_exclusion_rules('test@example.com', 'SKU-123', 10, rules)
        assert include is True
        assert qty == 20.0  # 10 / 0.5 = 20


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
