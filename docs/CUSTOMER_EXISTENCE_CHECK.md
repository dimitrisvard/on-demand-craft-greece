# Customer Existence Check by Email

## Overview

This feature ensures that when an RFQ (Request for Quote) is submitted through the quote form, the system checks if a customer already exists by email address. If a customer exists, the RFQ is stored under the existing customer record. If no customer exists, a new customer is created.

## How It Works

### 1. Email-Based Customer Lookup

When a quote form is submitted:
1. The system extracts the email address from the form
2. Queries the `customers` table to check if a customer with that email already exists
3. Uses the `email` field as the unique identifier for customer lookup

### 2. Customer Handling Logic

#### Existing Customer Found
- **Action**: Use the existing customer record
- **Update**: Refresh customer information with latest form data
- **RFQ Association**: Associate the new RFQ with the existing customer ID

#### No Customer Found
- **Action**: Create a new customer record
- **Data**: Use all form data to populate the new customer
- **RFQ Association**: Associate the new RFQ with the newly created customer ID

### 3. Database Constraints

- **Unique Email Constraint**: Added `customers_email_unique` constraint to prevent duplicate customers
- **Index**: Created index on email field for faster lookups
- **Referential Integrity**: RFQs maintain foreign key relationship with customers via `customer_id`

## Implementation Details

### Database Migration

```sql
-- Add unique constraint on email field
ALTER TABLE public.customers 
ADD CONSTRAINT customers_email_unique UNIQUE (email);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
```

### Utility Functions

The system uses centralized utility functions in `src/utils/customerUtils.ts`:

- `checkCustomerExists(email)`: Check if customer exists by email
- `createNewCustomer(values)`: Create new customer from form data
- `updateExistingCustomer(id, values)`: Update existing customer with new data
- `getOrCreateCustomer(values)`: Main function that handles the entire flow

### Quote Forms Updated

The following quote forms now implement customer existence checking:

1. **MultiStepQuoteForm** (`src/components/quote-form/MultiStepQuoteForm.tsx`)
2. **MicronsMultiStepForm** (`src/components/quote-form/MicronsMultiStepForm.tsx`)

## Benefits

### 1. Data Consistency
- Prevents duplicate customer records
- Maintains single source of truth for customer information
- Ensures RFQs are properly associated with customers

### 2. User Experience
- Returning customers don't need to re-enter company information
- System automatically updates customer details with latest information
- Seamless experience for repeat quote requests

### 3. Business Intelligence
- Better customer relationship tracking
- Accurate RFQ history per customer
- Improved analytics and reporting capabilities

### 4. Data Integrity
- Enforced email uniqueness at database level
- Consistent customer data across all RFQs
- Reduced data duplication and inconsistencies

## Technical Architecture

### Flow Diagram

```
Quote Form Submission
         ↓
Extract Email Address
         ↓
Query Customers Table
         ↓
Customer Exists? ──Yes──→ Update Customer Info
         ↓ No                    ↓
   Create New Customer      Use Existing Customer
         ↓                    ↓
   Store Customer ID        Store Customer ID
         ↓                    ↓
   Create RFQ              Create RFQ
         ↓                    ↓
   Associate with Customer Associate with Customer
```

### Database Schema

```sql
customers table:
- id (UUID, Primary Key)
- email (VARCHAR, Unique)
- company_name (VARCHAR)
- contact_name (VARCHAR)
- first_name (VARCHAR)
- last_name (VARCHAR)
- position (VARCHAR)
- phone (VARCHAR)
- vat_tax_id (VARCHAR)
- street_address (VARCHAR)
- city (VARCHAR)
- zip_code (VARCHAR)
- country (VARCHAR)
- status (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

rfqs table:
- id (UUID, Primary Key)
- customer_id (UUID, Foreign Key to customers.id)
- title (VARCHAR)
- status (VARCHAR)
- parts_details (JSONB)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

## Error Handling

### Customer Lookup Errors
- Logs detailed error information
- Throws errors to prevent incomplete RFQ creation
- Maintains data integrity

### Customer Update Errors
- Logs update failures
- Continues with existing customer data
- Doesn't block RFQ creation process

### Customer Creation Errors
- Logs creation failures
- Throws errors to prevent incomplete RFQ creation
- Ensures customer exists before RFQ creation

## Testing Considerations

### Test Scenarios

1. **New Customer Submission**
   - Verify new customer is created
   - Verify RFQ is associated with new customer

2. **Existing Customer Submission**
   - Verify existing customer is found
   - Verify customer info is updated
   - Verify RFQ is associated with existing customer

3. **Email Uniqueness**
   - Verify duplicate emails are rejected
   - Verify constraint violations are handled properly

4. **Error Scenarios**
   - Database connection failures
   - Constraint violations
   - Invalid data scenarios

### Test Data

- Use unique email addresses for each test
- Test with various customer data combinations
- Verify email format validation
- Test edge cases (empty strings, special characters)

## Future Enhancements

### Potential Improvements

1. **Customer Merge Functionality**
   - Handle cases where customers might have multiple email addresses
   - Merge duplicate customer records

2. **Customer Verification**
   - Email verification process
   - Phone number verification
   - Company registration validation

3. **Customer History**
   - Track all RFQ submissions per customer
   - Customer preference learning
   - Personalized quote suggestions

4. **Integration Features**
   - CRM system integration
   - Customer portal access
   - Automated follow-up communications

## Monitoring and Logging

### Key Metrics

- Customer creation vs. reuse rates
- Email lookup performance
- Error rates in customer operations
- RFQ association success rates

### Logging

- Customer lookup attempts and results
- Customer creation and update operations
- Error conditions and resolutions
- Performance metrics for database operations

## Security Considerations

### Data Protection

- Email addresses are treated as sensitive information
- Customer data updates are logged for audit purposes
- Access to customer data is restricted to authorized users

### Privacy Compliance

- Customer data handling follows GDPR principles
- Right to be forgotten implementation
- Data retention policies enforcement










