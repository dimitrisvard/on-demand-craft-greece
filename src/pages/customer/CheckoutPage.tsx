import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Check, CreditCard, Truck, Building, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { RFQ, RfqItem } from '@/types/customer';

function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

interface BillingAddress {
  companyName: string;
  streetAddress: string;
  city: string;
  zipCode: string;
  country: string;
  vatId: string;
}

interface ShippingAddress {
  companyName: string;
  streetAddress: string;
  city: string;
  zipCode: string;
  country: string;
}

interface CheckoutFormData {
  poNumber: string;
  discountCode: string;
  orderNotes: string;
  billingAddress: BillingAddress;
  shippingAddress: ShippingAddress;
  sameAsBilling: boolean;
  shippingMethod: 'standard' | 'express';
  paymentMethod: 'bank_transfer' | 'credit_card';
}

const initialFormData: CheckoutFormData = {
  poNumber: '',
  discountCode: '',
  orderNotes: '',
  billingAddress: {
    companyName: '',
    streetAddress: '',
    city: '',
    zipCode: '',
    country: '',
    vatId: '',
  },
  shippingAddress: {
    companyName: '',
    streetAddress: '',
    city: '',
    zipCode: '',
    country: '',
  },
  sameAsBilling: true,
  shippingMethod: 'standard',
  paymentMethod: 'bank_transfer',
};

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [formData, setFormData] = useState<CheckoutFormData>(initialFormData);
  const [discountApplied, setDiscountApplied] = useState(false);

  useEffect(() => {
    if (id) {
      fetchRfqData();
    }
  }, [id]);

  const fetchRfqData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('rfqs')
        .select('*')
        .eq('id', id!)
        .single();

      if (error) throw error;

      const rfqData = data as unknown as RFQ;
      setRfq(rfqData);

      // Pre-fill billing address from customer data if available
      if (rfqData.customer) {
        setFormData((prev) => ({
          ...prev,
          billingAddress: {
            companyName: rfqData.customer?.company_name || '',
            streetAddress: rfqData.customer?.street_address || rfqData.customer?.address || '',
            city: rfqData.customer?.city || '',
            zipCode: rfqData.customer?.zip_code || '',
            country: rfqData.customer?.country || '',
            vatId: rfqData.customer?.vat_tax_id || rfqData.customer_details?.vat_tax_id || '',
          },
        }));
      } else if (rfqData.customer_details) {
        setFormData((prev) => ({
          ...prev,
          billingAddress: {
            ...prev.billingAddress,
            vatId: rfqData.customer_details?.vat_tax_id || '',
          },
        }));
      }
    } catch (err: any) {
      toast({ title: 'Error loading quote', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDiscount = () => {
    if (!formData.discountCode.trim()) {
      toast({ title: 'Please enter a discount code', variant: 'destructive' });
      return;
    }
    // Placeholder: in production this would validate against the backend
    setDiscountApplied(true);
    toast({ title: 'Discount code applied', description: `Code "${formData.discountCode}" has been applied.` });
  };

  const handlePlaceOrder = async () => {
    // Basic validation
    const { billingAddress } = formData;
    if (!billingAddress.companyName || !billingAddress.streetAddress || !billingAddress.city || !billingAddress.zipCode || !billingAddress.country) {
      toast({ title: 'Please fill in all required billing address fields', variant: 'destructive' });
      return;
    }

    if (!formData.sameAsBilling) {
      const { shippingAddress } = formData;
      if (!shippingAddress.companyName || !shippingAddress.streetAddress || !shippingAddress.city || !shippingAddress.zipCode || !shippingAddress.country) {
        toast({ title: 'Please fill in all required shipping address fields', variant: 'destructive' });
        return;
      }
    }

    try {
      setPlacing(true);
      // Placeholder: in production this would create the order via Supabase
      await new Promise((resolve) => setTimeout(resolve, 1500));

      toast({ title: 'Order placed successfully!', description: 'You will receive a confirmation email shortly.' });
      navigate('/customer/projects');
    } catch (err: any) {
      toast({ title: 'Error placing order', description: err.message, variant: 'destructive' });
    } finally {
      setPlacing(false);
    }
  };

  const updateFormData = <K extends keyof CheckoutFormData>(key: K, value: CheckoutFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updateBillingField = (field: keyof BillingAddress, value: string) => {
    setFormData((prev) => ({
      ...prev,
      billingAddress: { ...prev.billingAddress, [field]: value },
    }));
  };

  const updateShippingField = (field: keyof ShippingAddress, value: string) => {
    setFormData((prev) => ({
      ...prev,
      shippingAddress: { ...prev.shippingAddress, [field]: value },
    }));
  };

  // Loading state
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  // Not found state
  if (!rfq) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">Quote not found</h3>
          <p className="text-muted-foreground mb-6">The quote you are looking for does not exist or has been removed.</p>
          <Button asChild variant="outline">
            <Link to="/customer/projects">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to my projects
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const parts: RfqItem[] = rfq.parts_details || [];
  const currency = rfq.currency || 'EUR';
  const subtotal = parts.reduce((sum, part) => sum + (part.total_price || 0), 0);
  const shippingCost = rfq.shipping_cost;
  const total = subtotal + (shippingCost || 0);

  // Step indicator component
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {/* Step 1 */}
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
            currentStep >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {currentStep > 1 ? <Check className="h-4 w-4" /> : '1'}
        </div>
        <span className={`text-sm font-medium ${currentStep >= 1 ? 'text-foreground' : 'text-muted-foreground'}`}>
          Confirm Editing
        </span>
      </div>

      {/* Connector */}
      <div className={`w-16 h-0.5 mx-2 transition-colors ${currentStep >= 2 ? 'bg-primary' : 'bg-muted'}`} />

      {/* Step 2 */}
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
            currentStep >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          2
        </div>
        <span className={`text-sm font-medium ${currentStep >= 2 ? 'text-foreground' : 'text-muted-foreground'}`}>
          Billing & Shipping
        </span>
      </div>
    </div>
  );

  // Step 1 content
  const renderStep1 = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: Order summary */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Order Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {parts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No parts in this quote.</p>
            ) : (
              <div className="space-y-4">
                {/* Table header */}
                <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground pb-2 border-b">
                  <div className="col-span-5">Part</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-2 text-right">Unit Price</div>
                  <div className="col-span-3 text-right">Total</div>
                </div>

                {/* Part rows */}
                {parts.map((part, index) => (
                  <div key={part.id || index} className="grid grid-cols-12 gap-4 text-sm items-center py-2">
                    <div className="col-span-5">
                      <p className="font-medium">{part.product_name}</p>
                      {part.description && (
                        <p className="text-muted-foreground text-xs mt-0.5 line-clamp-1">{part.description}</p>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      <Badge variant="secondary">{part.quantity}</Badge>
                    </div>
                    <div className="col-span-2 text-right">{formatCurrency(part.unit_price, currency)}</div>
                    <div className="col-span-3 text-right font-medium">{formatCurrency(part.total_price, currency)}</div>
                  </div>
                ))}

                <Separator />

                {/* Totals */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatCurrency(subtotal, currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Shipping</span>
                    <span className="font-medium">
                      {shippingCost != null ? formatCurrency(shippingCost, currency) : 'To be calculated'}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total (excl. VAT)</span>
                    <span>{formatCurrency(total, currency)}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right column: PO, discount, notes */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* PO Number */}
            <div className="space-y-2">
              <Label htmlFor="po-number">PO Number (optional)</Label>
              <Input
                id="po-number"
                placeholder="Enter PO number"
                value={formData.poNumber}
                onChange={(e) => updateFormData('poNumber', e.target.value)}
              />
            </div>

            {/* Discount Code */}
            <div className="space-y-2">
              <Label htmlFor="discount-code">Discount Code</Label>
              <div className="flex gap-2">
                <Input
                  id="discount-code"
                  placeholder="Enter code"
                  value={formData.discountCode}
                  onChange={(e) => updateFormData('discountCode', e.target.value)}
                  disabled={discountApplied}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApplyDiscount}
                  disabled={discountApplied}
                  className="shrink-0"
                >
                  {discountApplied ? 'Applied' : 'Apply'}
                </Button>
              </div>
              {discountApplied && (
                <p className="text-xs text-green-600">Discount code applied successfully.</p>
              )}
            </div>

            {/* Order Notes */}
            <div className="space-y-2">
              <Label htmlFor="order-notes">Order Notes</Label>
              <Textarea
                id="order-notes"
                placeholder="Add any special instructions or notes..."
                value={formData.orderNotes}
                onChange={(e) => updateFormData('orderNotes', e.target.value)}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        {/* Continue button */}
        <Button className="w-full" size="lg" onClick={() => setCurrentStep(2)}>
          Continue to Billing & Shipping
        </Button>
      </div>
    </div>
  );

  // Step 2 content
  const renderStep2 = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: addresses and options */}
      <div className="lg:col-span-2 space-y-6">
        {/* Billing Address */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              Billing Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="billing-company">Company Name *</Label>
                <Input
                  id="billing-company"
                  placeholder="Company name"
                  value={formData.billingAddress.companyName}
                  onChange={(e) => updateBillingField('companyName', e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="billing-street">Street Address *</Label>
                <Input
                  id="billing-street"
                  placeholder="Street address"
                  value={formData.billingAddress.streetAddress}
                  onChange={(e) => updateBillingField('streetAddress', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-city">City *</Label>
                <Input
                  id="billing-city"
                  placeholder="City"
                  value={formData.billingAddress.city}
                  onChange={(e) => updateBillingField('city', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-zip">ZIP Code *</Label>
                <Input
                  id="billing-zip"
                  placeholder="ZIP code"
                  value={formData.billingAddress.zipCode}
                  onChange={(e) => updateBillingField('zipCode', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-country">Country *</Label>
                <Input
                  id="billing-country"
                  placeholder="Country"
                  value={formData.billingAddress.country}
                  onChange={(e) => updateBillingField('country', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-vat">VAT ID</Label>
                <Input
                  id="billing-vat"
                  placeholder="e.g. DE123456789"
                  value={formData.billingAddress.vatId}
                  onChange={(e) => updateBillingField('vatId', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Shipping Address */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Shipping Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="same-as-billing"
                checked={formData.sameAsBilling}
                onCheckedChange={(checked) => updateFormData('sameAsBilling', checked === true)}
              />
              <Label htmlFor="same-as-billing" className="text-sm cursor-pointer">
                Same as billing address
              </Label>
            </div>

            {!formData.sameAsBilling && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="shipping-company">Company Name *</Label>
                  <Input
                    id="shipping-company"
                    placeholder="Company name"
                    value={formData.shippingAddress.companyName}
                    onChange={(e) => updateShippingField('companyName', e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="shipping-street">Street Address *</Label>
                  <Input
                    id="shipping-street"
                    placeholder="Street address"
                    value={formData.shippingAddress.streetAddress}
                    onChange={(e) => updateShippingField('streetAddress', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping-city">City *</Label>
                  <Input
                    id="shipping-city"
                    placeholder="City"
                    value={formData.shippingAddress.city}
                    onChange={(e) => updateShippingField('city', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping-zip">ZIP Code *</Label>
                  <Input
                    id="shipping-zip"
                    placeholder="ZIP code"
                    value={formData.shippingAddress.zipCode}
                    onChange={(e) => updateShippingField('zipCode', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shipping-country">Country *</Label>
                  <Input
                    id="shipping-country"
                    placeholder="Country"
                    value={formData.shippingAddress.country}
                    onChange={(e) => updateShippingField('country', e.target.value)}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shipping Method */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Shipping Method
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={formData.shippingMethod}
              onValueChange={(value) => updateFormData('shippingMethod', value as 'standard' | 'express')}
              className="space-y-3"
            >
              <div className="flex items-center justify-between rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="standard" id="shipping-standard" />
                  <div>
                    <Label htmlFor="shipping-standard" className="cursor-pointer font-medium">
                      Standard Shipping
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Estimated 5-7 business days</p>
                  </div>
                </div>
                <span className="text-sm font-medium">{formatCurrency(15, currency)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="express" id="shipping-express" />
                  <div>
                    <Label htmlFor="shipping-express" className="cursor-pointer font-medium">
                      Express Shipping
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Estimated 2-3 business days</p>
                  </div>
                </div>
                <span className="text-sm font-medium">{formatCurrency(45, currency)}</span>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payment Method
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={formData.paymentMethod}
              onValueChange={(value) => updateFormData('paymentMethod', value as 'bank_transfer' | 'credit_card')}
              className="space-y-3"
            >
              <div className="flex items-center rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="bank_transfer" id="payment-bank" />
                  <div>
                    <Label htmlFor="payment-bank" className="cursor-pointer font-medium">
                      Bank Transfer
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Pay via bank transfer after order confirmation</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center rounded-lg border border-dashed p-4 opacity-60 cursor-not-allowed">
                <div className="flex items-center gap-3">
                  <RadioGroupItem value="credit_card" id="payment-card" disabled />
                  <div>
                    <Label htmlFor="payment-card" className="cursor-not-allowed font-medium">
                      Credit Card
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Coming soon</p>
                  </div>
                </div>
                <Badge variant="outline" className="ml-auto text-xs">
                  Coming Soon
                </Badge>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
      </div>

      {/* Right column: order summary + actions */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Total</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal ({parts.length} items)</span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Shipping</span>
              <span>
                {formatCurrency(formData.shippingMethod === 'express' ? 45 : 15, currency)}
              </span>
            </div>
            {formData.poNumber && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">PO Number</span>
                <span className="font-mono text-xs">{formData.poNumber}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total (excl. VAT)</span>
              <span>
                {formatCurrency(subtotal + (formData.shippingMethod === 'express' ? 45 : 15), currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={handlePlaceOrder} disabled={placing}>
          {placing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              Placing Order...
            </>
          ) : (
            'Place Order'
          )}
        </Button>

        <Button variant="outline" className="w-full" onClick={() => setCurrentStep(1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Review
        </Button>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page header */}
      <div className="mb-6">
        <Link
          to={`/customer/quotes/${id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to quote
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <p className="text-muted-foreground mt-1">
          Quote {rfq.rfq_number || rfq.title || rfq.id.slice(0, 8)}
          {rfq.created_at && ` - Created ${format(new Date(rfq.created_at), 'MMM dd, yyyy')}`}
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator />

      {/* Step content */}
      {currentStep === 1 ? renderStep1() : renderStep2()}
    </div>
  );
}
