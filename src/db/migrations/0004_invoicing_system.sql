-- Migration: Add Invoicing System Tables
-- Description: Create tables for purchase orders, invoices, invoice items, and payments
-- Version: 0004
-- Date: 2025-01-19

-- Create Purchase Orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(100) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id)
);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id UUID NOT NULL;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'shipped', 'received', 'cancelled'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_delivery_date TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS actual_delivery_date TIMESTAMPTZ;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12,2) DEFAULT 0 NOT NULL;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS billing_address JSONB DEFAULT '{}' NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_address JSONB DEFAULT '{}' NOT NULL;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS internal_notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}' NOT NULL;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- Create Purchase Order Items table
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    
    -- Item details
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    
    -- Tracking
    quantity_received INTEGER DEFAULT 0 NOT NULL,
    quantity_invoiced INTEGER DEFAULT 0 NOT NULL,
    
    -- Product details at time of order
    product_sku VARCHAR(100) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    
    -- Entity relationships
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    customer_id UUID REFERENCES customers(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    
    -- Invoice details
    invoice_type VARCHAR(50) DEFAULT 'purchase' NOT NULL CHECK (invoice_type IN ('purchase', 'sales', 'credit_note', 'debit_note')),
    status VARCHAR(50) DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'paid', 'overdue', 'cancelled', 'disputed')),
    
    -- Dates
    invoice_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    paid_date TIMESTAMPTZ,
    
    -- Financial information
    subtotal DECIMAL(12,2) DEFAULT 0 NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0 NOT NULL,
    shipping_cost DECIMAL(12,2) DEFAULT 0 NOT NULL,
    discount_amount DECIMAL(12,2) DEFAULT 0 NOT NULL,
    total_amount DECIMAL(12,2) DEFAULT 0 NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0 NOT NULL,
    balance_amount DECIMAL(12,2) DEFAULT 0 NOT NULL,
    
    -- Payment terms
    payment_terms JSONB DEFAULT '{}' NOT NULL,
    
    -- Addresses
    billing_address JSONB DEFAULT '{}' NOT NULL,
    shipping_address JSONB DEFAULT '{}' NOT NULL,
    
    -- Document management
    document_path VARCHAR(500),
    document_hash VARCHAR(256),
    
    -- Notes and metadata
    notes TEXT,
    internal_notes TEXT,
    metadata JSONB DEFAULT '{}' NOT NULL,
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create Invoice Items table
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    purchase_order_item_id UUID REFERENCES purchase_order_items(id),
    
    -- Item details
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0 NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0 NOT NULL,
    
    -- Product details at time of invoice
    product_sku VARCHAR(100),
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    
    -- Custom line items support
    item_type VARCHAR(50) DEFAULT 'product' NOT NULL CHECK (item_type IN ('product', 'service', 'fee', 'discount')),
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create Payment Records table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(100) UNIQUE NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    
    -- Payment details
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('bank_transfer', 'check', 'cash', 'credit_card', 'eft', 'wire_transfer')),
    payment_amount DECIMAL(12,2) NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Banking information
    bank_reference VARCHAR(100),
    check_number VARCHAR(50),
    transaction_id VARCHAR(100),
    
    -- Status and reconciliation
    status VARCHAR(50) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'cleared', 'bounced', 'cancelled')),
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID,
    
    -- Notes and metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}' NOT NULL,
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for Purchase Orders
CREATE INDEX IF NOT EXISTS po_order_number_idx ON purchase_orders(order_number);
CREATE INDEX IF NOT EXISTS po_supplier_idx ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS po_customer_idx ON purchase_orders(customer_id);
CREATE INDEX IF NOT EXISTS po_status_idx ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS po_order_date_idx ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS po_total_amount_idx ON purchase_orders(total_amount);

-- Create indexes for Purchase Order Items
CREATE INDEX IF NOT EXISTS poi_purchase_order_idx ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS poi_product_idx ON purchase_order_items(product_id);

-- Create indexes for Invoices
CREATE INDEX IF NOT EXISTS invoice_number_idx ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS invoice_supplier_idx ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS invoice_customer_idx ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS invoice_po_idx ON invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS invoice_status_idx ON invoices(status);
CREATE INDEX IF NOT EXISTS invoice_type_idx ON invoices(invoice_type);
CREATE INDEX IF NOT EXISTS invoice_date_idx ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS invoice_due_date_idx ON invoices(due_date);
CREATE INDEX IF NOT EXISTS invoice_total_amount_idx ON invoices(total_amount);

-- Create indexes for Invoice Items
CREATE INDEX IF NOT EXISTS invoice_item_invoice_idx ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_item_product_idx ON invoice_items(product_id);
CREATE INDEX IF NOT EXISTS invoice_item_po_item_idx ON invoice_items(purchase_order_item_id);

-- Create indexes for Payments
CREATE INDEX IF NOT EXISTS payment_number_idx ON payments(payment_number);
CREATE INDEX IF NOT EXISTS payment_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payment_method_idx ON payments(payment_method);
CREATE INDEX IF NOT EXISTS payment_date_idx ON payments(payment_date);
CREATE INDEX IF NOT EXISTS payment_status_idx ON payments(status);

-- Create trigger to update balance_amount when payments are made
CREATE OR REPLACE FUNCTION update_invoice_balance()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE invoices 
    SET 
        paid_amount = COALESCE((
            SELECT SUM(payment_amount) 
            FROM payments 
            WHERE invoice_id = NEW.invoice_id 
            AND status = 'cleared'
        ), 0),
        balance_amount = total_amount - COALESCE((
            SELECT SUM(payment_amount) 
            FROM payments 
            WHERE invoice_id = NEW.invoice_id 
            AND status = 'cleared'
        ), 0),
        updated_at = NOW()
    WHERE id = NEW.invoice_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for payment updates
DROP TRIGGER IF EXISTS payment_balance_update_trigger ON payments;
CREATE TRIGGER payment_balance_update_trigger
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_balance();

-- Update invoice status based on balance
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE invoices 
    SET 
        status = CASE 
            WHEN balance_amount <= 0 THEN 'paid'
            WHEN paid_amount > 0 AND balance_amount > 0 THEN 'partial'
            WHEN due_date < NOW() AND balance_amount > 0 THEN 'overdue'
            ELSE status
        END,
        paid_date = CASE 
            WHEN balance_amount <= 0 AND paid_date IS NULL THEN NOW()
            WHEN balance_amount > 0 THEN NULL
            ELSE paid_date
        END
    WHERE id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for invoice status updates
DROP TRIGGER IF EXISTS invoice_status_update_trigger ON invoices;
CREATE TRIGGER invoice_status_update_trigger
    AFTER UPDATE OF paid_amount, balance_amount ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_status();

-- Insert sample data (optional - remove for production)