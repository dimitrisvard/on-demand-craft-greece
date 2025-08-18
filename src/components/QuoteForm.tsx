
import { useState } from 'react';
import { Upload, Check, AlertCircle } from 'lucide-react';

const QuoteForm = () => {
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    phone: '',
    service: '',
    quantity: '',
    material: '',
    deadline: '',
    description: ''
  });
  
  const [fileUploaded, setFileUploaded] = useState(false);
  const [fileName, setFileName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormState(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileUploaded(true);
      setFileName(e.target.files[0].name);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitSuccess(true);
      
      // Reset form after 3 seconds
      setTimeout(() => {
        setFormState({
          name: '',
          email: '',
          phone: '',
          service: '',
          quantity: '',
          material: '',
          deadline: '',
          description: ''
        });
        setFileUploaded(false);
        setFileName('');
        setSubmitSuccess(false);
      }, 3000);
    }, 1500);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
      {submitSuccess ? (
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center bg-green-100 p-3 rounded-full mb-4">
            <Check size={24} className="text-green-600" />
          </div>
          <h3 className="text-2xl font-bold text-gray-800 mb-2">Quote Request Submitted!</h3>
          <p className="text-gray-600">We'll get back to you with pricing details shortly.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="name">
                Full Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formState.name}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formState.email}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                required
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="phone">
                Phone Number
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formState.phone}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="service">
                Service Type
              </label>
              <select
                id="service"
                name="service"
                value={formState.service}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                required
              >
                <option value="" disabled>Select a service</option>
                <option value="cnc">CNC Machining</option>
                <option value="sheet-metal">Sheet Metal Fabrication</option>
                <option value="3d-printing">3D Printing</option>
                <option value="injection-molding">Injection Molding</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="quantity">
                Quantity
              </label>
              <input
                type="number"
                id="quantity"
                name="quantity"
                value={formState.quantity}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                min="1"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="material">
                Material
              </label>
              <input
                type="text"
                id="material"
                name="material"
                value={formState.material}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
                placeholder="e.g. Aluminum, Steel"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="deadline">
                Deadline
              </label>
              <input
                type="date"
                id="deadline"
                name="deadline"
                value={formState.deadline}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="description">
              Project Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formState.description}
              onChange={handleInputChange}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-brand-teal focus:border-transparent"
              placeholder="Describe your project requirements..."
            />
          </div>
          
          <div className="border-2 border-dashed border-gray-300 rounded-md p-6 text-center">
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={handleFileChange}
              accept=".stl,.step,.stp,.iges,.igs,.obj,.dxf,.dwg"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <div className="space-y-2">
                {fileUploaded ? (
                  <>
                    <div className="flex items-center justify-center">
                      <Check size={24} className="text-green-500 mr-2" />
                      <span className="font-medium text-green-600">File Uploaded</span>
                    </div>
                    <p className="text-sm text-gray-500">{fileName}</p>
                    <p className="text-xs text-gray-500 underline mt-2">Click to change file</p>
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-brand-teal">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-gray-500">
                      STL, STEP, IGES, OBJ, DXF, DWG (Max 50MB)
                    </p>
                  </>
                )}
              </div>
            </label>
          </div>
          
          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="terms"
                type="checkbox"
                className="focus:ring-brand-teal h-4 w-4 text-brand-teal border-gray-300 rounded"
                required
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="terms" className="font-medium text-gray-700">
                I agree to the <a href="#" className="text-brand-teal hover:underline">Terms of Service</a> and <a href="#" className="text-brand-teal hover:underline">Privacy Policy</a>
              </label>
            </div>
          </div>
          
          <button
            type="submit"
            className="w-full btn-primary py-3 flex justify-center items-center"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : "Submit Quote Request"}
          </button>
          
          <div className="text-xs text-gray-500 flex items-center">
            <AlertCircle size={14} className="mr-1" />
            All quotes are typically processed within 24 hours
          </div>
        </form>
      )}
    </div>
  );
};

export default QuoteForm;
