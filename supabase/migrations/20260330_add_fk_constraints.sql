-- Clean up orphaned orders referencing deleted RFQs
UPDATE orders SET rfq_id = NULL WHERE rfq_id IS NOT NULL
  AND rfq_id NOT IN (SELECT id FROM rfqs);

-- Add FK from orders.rfq_id to rfqs.id (enables PostgREST embed joins)
ALTER TABLE orders ADD CONSTRAINT orders_rfq_id_fkey
  FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE SET NULL;

-- Clean up orphaned rfq_files referencing deleted RFQs
DELETE FROM rfq_files WHERE rfq_id NOT IN (SELECT id FROM rfqs);

-- Add FK from rfq_files.rfq_id to rfqs.id
ALTER TABLE rfq_files ADD CONSTRAINT rfq_files_rfq_id_fkey
  FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE;
