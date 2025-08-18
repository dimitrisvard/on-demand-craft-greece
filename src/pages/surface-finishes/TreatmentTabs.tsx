import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";

const TreatmentTabs = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-8 text-center">{t('service_surface-finishes_treatments_heading', 'We offer these (and more) surface treatments')}</h2>
        
        <Tabs defaultValue="electroplating" className="w-full">
          <TabsList className="w-full flex flex-wrap justify-center gap-2 mb-8">
            <TabsTrigger value="electroplating">{t('service_surface-finishes_treatments_tab_electroplating', 'Electroplating')}</TabsTrigger>
            <TabsTrigger value="heat">{t('service_surface-finishes_treatments_tab_heat', 'Heat Treatments')}</TabsTrigger>
            <TabsTrigger value="mechanical">{t('service_surface-finishes_treatments_tab_mechanical', 'Mechanical Finishes')}</TabsTrigger>
          </TabsList>

          <TabsContent value="electroplating" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_anodizing_title', 'Anodizing')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_anodizing_desc', 'In surface technology, anodizing refers to a group of coating processes in which oxide layers are produced or reinforced on metallic objects by means of electrolysis. In anodizing, the metal is submerged in an electrolytic solution (e.g. sulfuric acid) and functions as an anode (positive pole). The electric current forms an oxide layer on the component\'s surface, which can vary in thickness depending on the strength of the voltage. Anodizing aluminum is the most widely used process.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_hard_anodizing_title', 'Hard Anodizing')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_hard_anodizing_desc', 'Hard anodizing is a process of electrolytic oxidation of aluminum materials to create protective layers on the surface. These serve as wear and/or corrosion protection, have good tribological properties and, depending on the counterpart, have very good sliding properties which can be further improved through PTFE impregnation.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_black_finishing_title', 'Black Finishing')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_black_finishing_desc', 'To create corrosion protection for ferrous surfaces, black finishing involves submerging workpieces in baths containing acidic or alkaline solutions or molten salts. This process forms an oxide layer of a striking deep black color on the surface, the thickness of which is approximately 1 µm.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_passivating_title', 'Passivating')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_passivating_desc', 'In surface technology, passivation refers to the spontaneous formation or targeted creation of a protective layer on a metallic material that prevents or greatly slows down corrosion of the base material.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_phosphate_title', 'Phosphate Conversion Coating')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_phosphate_desc', 'Phosphate conversion coating is a widely used process in which chemical reactions of metallic surfaces with aqueous phosphate solutions form a conversion layer of firmly adhering metal phosphates.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_nickel_title', 'Nickel Plating')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_nickel_desc', 'Nickel plating is the collective term for various processes for producing a nickel coating on mostly metallic objects. Nickel is resistant to air, water, diluted acids and most alkalis.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_galvanizing_title', 'Galvanizing (Zinc Plating)')}</h3>
                <p className="text-gray-700">{t('service_surface-finishes_treatments_galvanizing_desc', 'Through galvanizing, steel is provided with a thin layer of zinc to protect it from corrosion. As a metallic coating, zinc offers active corrosion protection by acting as a sacrificial anode.')}</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="heat" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_hardening_title', 'Hardening')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_hardening_desc', 'The hardening of ferrous materials is an increase of its mechanical resistance by targeted modification and transformation of its microstructure. It can be achieved through heat treatment with subsequent quenching.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_quenching_title', 'Quenching and Tempering')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_quenching_desc', 'Quenching and tempering describes the combined heat treatment of metals, consisting of hardening and subsequent tempering. This type of thermal microstructure formation and change is also common for non-ferrous metals such as titanium alloys.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_case_hardening_title', 'Case Hardening')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_case_hardening_desc', 'Case hardening is a method with which the outer layer of metallic components can be hardened. According to DIN, the term covers only those processes in which the surface layer is austenitized.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_nitriding_title', 'Nitriding (Gas and Plasma)')}</h3>
                <p className="text-gray-700">{t('service_surface-finishes_treatments_nitriding_desc', 'Nitriding is a heat treating process that diffuses nitrogen into the surface of a metal to create a case-hardened surface. These processes are most commonly used on low-carbon, low-alloy steels.')}</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mechanical" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_laser_title', 'Laser Engraving')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_laser_desc', 'Laser engraving is the marking of objects using an intensive laser beam. Laser inscriptions are waterproof, smudge-proof and very durable.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_polishing_title', 'Polishing')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_polishing_desc', 'Polishing is a machining process where polishing grain contained in polishing paste mechanically penetrates the surface. Uneven areas, furrows and grooves are levelled out to produce surfaces that are as uniform as possible.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_grinding_title', 'Grinding')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_grinding_desc', 'Grinding is a cutting manufacturing process for fine and finish machining of workpieces. The edges of the microscopically small, hard, mineral crystals in the grinding tool act as cutting edges.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_sandblasting_title', 'Sandblasting')}</h3>
                <p className="text-gray-700 mb-6">{t('service_surface-finishes_treatments_sandblasting_desc', 'Sandblasting refers to the surface treatment of a material by the action of abrasives against rust, dirt, paint, scale and other impurities or for surface design by matting.')}</p>

                <h3 className="text-xl font-bold mb-4">{t('service_surface-finishes_treatments_glassbead_title', 'Glass Bead Blasting')}</h3>
                <p className="text-gray-700">{t('service_surface-finishes_treatments_glassbead_desc', 'Glass bead blasting is a mechanical surface treatment similar to sand blasting, using tiny glass beads as the blasting medium for smoothing and compacting surfaces.')}</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
};

export default TreatmentTabs;
